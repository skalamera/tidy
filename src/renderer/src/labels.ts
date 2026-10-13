import type { SectionStatus } from '../../shared/state';

/** Plain-English status shown in the sidebar and on each step's header. */
export const STATUS_LABEL: Record<SectionStatus, string> = {
  locked: 'Later',
  working: 'Reading…',
  needs_answers: 'Needs answers',
  ready: 'Ready to approve',
  approved: 'Approved',
  needs_reapproval: 'Changed, approve again',
};
