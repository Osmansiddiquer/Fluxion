export type FeatureKind =
  | 'max'
  | 'min'
  | 'root'
  | 'yIntercept'
  | 'endpoint'
  | 'discontinuity'
  | 'intersection';

export interface Feature {
  kind: FeatureKind;
  t: number;
  y: number;
  /** For intersections: the two entries involved. */
  aId?: string;
  bId?: string;
}

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  max: 'Maximum',
  min: 'Minimum',
  root: 'Zero',
  yIntercept: 'y-intercept',
  endpoint: 'Endpoint',
  discontinuity: 'Discontinuity',
  intersection: 'Intersection',
};
