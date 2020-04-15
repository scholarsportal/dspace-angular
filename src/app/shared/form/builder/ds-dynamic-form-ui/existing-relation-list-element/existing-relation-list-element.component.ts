import { Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { DynamicFormArrayGroupModel } from '@ng-dynamic-forms/core';
import { Store } from '@ngrx/store';
import { Observable, of as observableOf, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AppState } from '../../../../../app.reducer';
import { Item } from '../../../../../core/shared/item.model';
import { getAllSucceededRemoteData, getRemoteDataPayload } from '../../../../../core/shared/operators';
import { hasValue, isNotEmpty } from '../../../../empty.util';
import { ItemSearchResult } from '../../../../object-collection/shared/item-search-result.model';
import { SelectableListService } from '../../../../object-list/selectable-list/selectable-list.service';
import { FormFieldMetadataValueObject } from '../../models/form-field-metadata-value.model';
import { RelationshipOptions } from '../../models/relationship-options.model';
import { DynamicConcatModel } from '../models/ds-dynamic-concat.model';
import { RemoveRelationshipAction } from '../relation-lookup-modal/relationship.actions';
import { ViewMode } from '../../../../../core/shared/view-mode.model';
import { ReorderableRelationship } from '../existing-metadata-list-element/existing-metadata-list-element.component';
import {
  SaveSubmissionFormAction
} from '../../../../../submission/objects/submission-objects.actions';

// tslint:disable:max-classes-per-file
/**
 * Abstract class that defines objects that can be reordered
 */
export abstract class Reorderable {

  constructor(public oldIndex?: number, public newIndex?: number) {
  }

  /**
   * Return the id for this Reorderable
   */
  abstract getId(): string;

  /**
   * Return the place metadata for this Reorderable
   */
  abstract getPlace(): number;

  /**
   * Update the Reorderable
   */
  abstract update(): Observable<any>;

  /**
   * Returns true if the oldIndex of this Reorderable
   * differs from the newIndex
   */
  get hasMoved(): boolean {
    return this.oldIndex !== this.newIndex
  }
}

/**
 * A Reorderable representation of a FormFieldMetadataValue
 */
export class ReorderableFormFieldMetadataValue extends Reorderable {

  constructor(
    public metadataValue: FormFieldMetadataValueObject,
    public model: DynamicConcatModel,
    public control: FormControl,
    public group: DynamicFormArrayGroupModel,
    oldIndex?: number,
    newIndex?: number
  ) {
    super(oldIndex, newIndex);
    this.metadataValue = metadataValue;
  }

  /**
   * Return the id for this Reorderable
   */
  getId(): string {
    if (hasValue(this.metadataValue.authority)) {
      return this.metadataValue.authority;
    } else {
      // can't use UUIDs, they're generated client side
      return this.metadataValue.value;
    }
  }

  /**
   * Return the place metadata for this Reorderable
   */
  getPlace(): number {
    return this.metadataValue.place;
  }

  /**
   * Update the Reorderable
   */
  update(): Observable<FormFieldMetadataValueObject> {
    this.oldIndex = this.newIndex;
    return observableOf(this.metadataValue);
  }

}

/**
 * Represents a single existing relationship value as metadata in submission
 */
@Component({
  selector: 'ds-existing-relation-list-element',
  templateUrl: './existing-relation-list-element.component.html',
  styleUrls: ['./existing-relation-list-element.component.scss']
})
export class ExistingRelationListElementComponent implements OnInit, OnChanges, OnDestroy {
  @Input() listId: string;
  @Input() submissionItem: Item;
  @Input() reoRel: ReorderableRelationship;
  @Input() metadataFields: string[];
  @Input() relationshipOptions: RelationshipOptions;
  @Input() submissionId: string;
  relatedItem: Item;
  viewType = ViewMode.ListElement;

  /**
   * List of subscriptions to unsubscribe from
   */
  private subs: Subscription[] = [];

  constructor(
    private selectableListService: SelectableListService,
    private store: Store<AppState>
  ) {
  }

  ngOnInit(): void {
    this.ngOnChanges();
  }

  /**
   * Change callback for the component
   */
  ngOnChanges() {
    if (hasValue(this.reoRel)) {
      const item$ = this.reoRel.useLeftItem ?
        this.reoRel.relationship.leftItem : this.reoRel.relationship.rightItem;
      this.subs.push(item$.pipe(
        getAllSucceededRemoteData(),
        getRemoteDataPayload(),
        filter((item: Item) => hasValue(item) && isNotEmpty(item.uuid))
      ).subscribe((item: Item) => {
        this.relatedItem = item;
      }));
    }

  }

  /**
   * Removes the selected relationship from the list
   */
  removeSelection() {
    this.selectableListService.deselectSingle(this.listId, Object.assign(new ItemSearchResult(), { indexableObject: this.relatedItem }));
    this.store.dispatch(new RemoveRelationshipAction(this.submissionItem, this.relatedItem, this.relationshipOptions.relationshipType, this.submissionId));
  }

  /**
   * Unsubscribe from all subscriptions
   */
  ngOnDestroy(): void {
    this.subs
      .filter((sub) => hasValue(sub))
      .forEach((sub) => sub.unsubscribe());
  }

}

// tslint:enable:max-classes-per-file
