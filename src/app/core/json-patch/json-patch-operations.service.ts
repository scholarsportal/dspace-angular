import { merge as observableMerge, Observable, of as observableOf, throwError as observableThrowError } from 'rxjs';
import { distinctUntilChanged, filter, flatMap, map, mergeMap, partition, take, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { hasValue, isEmpty, isNotEmpty, isNotUndefined, isUndefined } from '../../shared/empty.util';
import { ErrorResponse, PostPatchSuccessResponse, RestResponse } from '../cache/response-cache.models';
import { ResponseCacheEntry } from '../cache/response-cache.reducer';
import { ResponseCacheService } from '../cache/response-cache.service';
import { PatchRequest, RestRequest } from '../data/request.models';
import { RequestService } from '../data/request.service';
import { HALEndpointService } from '../shared/hal-endpoint.service';
import { CoreState } from '../core.reducers';
import { jsonPatchOperationsByResourceType } from './selectors';
import { JsonPatchOperationsResourceEntry } from './json-patch-operations.reducer';
import {
  CommitPatchOperationsAction,
  RollbacktPatchOperationsAction,
  StartTransactionPatchOperationsAction
} from './json-patch-operations.actions';
import { JsonPatchOperationModel } from './json-patch.model';

export abstract class JsonPatchOperationsService<ResponseDefinitionDomain, PatchRequestDefinition extends PatchRequest> {
  protected abstract responseCache: ResponseCacheService;
  protected abstract requestService: RequestService;
  protected abstract store: Store<CoreState>;
  protected abstract linkPath: string;
  protected abstract halService: HALEndpointService;
  protected abstract patchRequestConstructor: any;

  protected submitData(request: RestRequest): Observable<ResponseDefinitionDomain> {
    const responses = this.responseCache.get(request.href).pipe(map((entry: ResponseCacheEntry) => entry.response));
    const errorResponses = responses.pipe(
      filter((response) => !response.isSuccessful),
      mergeMap(() => observableThrowError(new Error(`Couldn't send data to server`)))
    );
    const successResponses = responses.pipe(
      filter((response: PostPatchSuccessResponse) => isNotEmpty(response)),
      map((response: PostPatchSuccessResponse) => response.dataDefinition)
    );
    return observableMerge(errorResponses, successResponses);
  }

  protected submitJsonPatchOperations(hrefObs: Observable<string>, resourceType: string, resourceId?: string): Observable<ResponseDefinitionDomain> {
    let startTransactionTime = null;
    const [patchRequest$, emptyRequest$] = partition((request: PatchRequestDefinition) => isNotEmpty(request.body))(hrefObs.pipe(
      flatMap((endpointURL: string) => {
        return this.store.select(jsonPatchOperationsByResourceType(resourceType)).pipe(
          take(1),
          filter((operationsList: JsonPatchOperationsResourceEntry) => isUndefined(operationsList) || !(operationsList.commitPending)),
          tap(() => startTransactionTime = new Date().getTime()),
          map((operationsList: JsonPatchOperationsResourceEntry) => {
            const body: JsonPatchOperationModel[] = [];
            if (isNotEmpty(operationsList)) {
              if (isNotEmpty(resourceId)) {
                if (isNotUndefined(operationsList.children[resourceId]) && isNotEmpty(operationsList.children[resourceId].body)) {
                  operationsList.children[resourceId].body.forEach((entry) => {
                    body.push(entry.operation);
                  });
                }
              } else {
                Object.keys(operationsList.children)
                  .filter((key) => operationsList.children.hasOwnProperty(key))
                  .filter((key) => hasValue(operationsList.children[key]))
                  .filter((key) => hasValue(operationsList.children[key].body))
                  .forEach((key) => {
                    operationsList.children[key].body.forEach((entry) => {
                      body.push(entry.operation);
                    });
                  })
              }
            }
            return this.getRequestInstance(this.requestService.generateRequestId(), endpointURL, body);
          }));
      })));

    return observableMerge(
      emptyRequest$.pipe(
        filter((request: PatchRequestDefinition) => isEmpty(request.body)),
        tap(() => startTransactionTime = null),
        map(() => null)),
      patchRequest$.pipe(
        filter((request: PatchRequestDefinition) => isNotEmpty(request.body)),
        tap(() => this.store.dispatch(new StartTransactionPatchOperationsAction(resourceType, resourceId, startTransactionTime))),
        tap((request: PatchRequestDefinition) => this.requestService.configure(request, true)),
        flatMap((request: PatchRequestDefinition) => {
          const [successResponse$, errorResponse$] = partition((response: RestResponse) => response.isSuccessful)(this.responseCache.get(request.href).pipe(
            filter((entry: ResponseCacheEntry) => startTransactionTime < entry.timeAdded),
            take(1),
            map((entry: ResponseCacheEntry) => entry.response)
          ));
          return observableMerge(
            errorResponse$.pipe(
              tap(() => this.store.dispatch(new RollbacktPatchOperationsAction(resourceType, resourceId))),
              flatMap((response: ErrorResponse) => observableOf(new Error(`Couldn't patch operations`)))),
            successResponse$.pipe(
              filter((response: PostPatchSuccessResponse) => isNotEmpty(response)),
              tap(() => this.store.dispatch(new CommitPatchOperationsAction(resourceType, resourceId))),
              map((response: PostPatchSuccessResponse) => response.dataDefinition),
              distinctUntilChanged()));
        }))
    );
  }

  protected getRequestInstance(uuid: string, href: string, body?: any): PatchRequestDefinition {
    return new this.patchRequestConstructor(uuid, href, body);
  }

  protected getEndpointByIDHref(endpoint, resourceID): string {
    return isNotEmpty(resourceID) ? `${endpoint}/${resourceID}` : `${endpoint}`;
  }

  public jsonPatchByResourceType(linkName: string, scopeId: string, resourceType: string): Observable<ResponseDefinitionDomain> {
    const href$ = this.halService.getEndpoint(linkName).pipe(
      filter((href: string) => isNotEmpty(href)),
      distinctUntilChanged(),
      map((endpointURL: string) => this.getEndpointByIDHref(endpointURL, scopeId)));

    return this.submitJsonPatchOperations(href$, resourceType);
  }

  public jsonPatchByResourceID(linkName: string, scopeId: string, resourceType: string, resourceId: string): Observable<ResponseDefinitionDomain> {
    const hrefObs = this.halService.getEndpoint(linkName).pipe(
      filter((href: string) => isNotEmpty(href)),
      distinctUntilChanged(),
      map((endpointURL: string) => this.getEndpointByIDHref(endpointURL, scopeId)));

    return this.submitJsonPatchOperations(hrefObs, resourceType, resourceId);
  }
}
