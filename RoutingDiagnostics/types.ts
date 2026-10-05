/** Shared types for the Routing Diagnostics control. */

/** A row of msdyn_ocliveworkitem: one routing attempt for a record or conversation. */
export interface LiveWorkItem {
  activityid: string;
  subject: string | null;
  statecode: number;
  statecodeLabel: string | null;
  /** statuscode is the option set the platform maintains; its formatted value is
   *  what the form shows. msdyn_statereason is a free-text field that routing does
   *  not keep up to date, so it is deliberately not read. */
  statusCodeLabel: string | null;
  statusChangeReason: string | null;
  createdOn: string | null;
  closedOn: string | null;
  firstWaitStartedOn: string | null;
  startedOn: string | null;
  /** The platform's own rendering of the same instant, in the person's Dynamics
   *  time zone and date format. Shown as given; the raw values above are only
   *  used for sorting and for measuring durations. */
  createdOnLabel: string | null;
  closedOnLabel: string | null;
  isAgentAccepted: boolean;
  isAbandoned: boolean;
  activeAgentId: string | null;
  activeAgentName: string | null;
  conversationId: string | null;
  routableObjectId: string | null;
  routableObjectLogicalName: string | null;
  workstreamId: string | null;
  workstreamName: string | null;
  queueId: string | null;
  queueName: string | null;
  queueItemId: string | null;
}

/** One routed record (a case, an email, a custom row) or a standalone conversation,
 *  together with every live work item that routing produced for it. */
export interface RoutedSubject {
  key: string;
  title: string;
  logicalName: string | null;
  recordId: string | null;
  workstreamName: string | null;
  items: LiveWorkItem[];
  latest: LiveWorkItem;
  outcome: Outcome;
}

export type OutcomeKind =
  | "waitingAssignment"
  | "waitingAcceptance"
  | "inConversation"
  | "abandoned"
  | "closed"
  | "unknown";

export interface Outcome {
  kind: OutcomeKind;
  label: string;
  detail: string | null;
}

/** A row of msdyn_ocsession. */
export interface Session {
  activityid: string;
  liveWorkItemId: string | null;
  createdOn: string | null;
  closedOn: string | null;
  createdOnLabel: string | null;
  closedOnLabel: string | null;
  closureReason: string | null;
  queueAssignedOn: string | null;
  queueAssignedReason: string | null;
  agentAssignedOn: string | null;
  agentAcceptedOn: string | null;
  participants: SessionParticipant[];
}

/** A row of msdyn_sessionparticipant. */
export interface SessionParticipant {
  id: string;
  agentId: string | null;
  agentName: string | null;
  mode: string | null;
  assignReason: string | null;
  addedOn: string | null;
  joinedOnLabel: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  leftOnReason: string | null;
  isCapacityBlocking: boolean;
}

/** A row of queueitem. */
export interface QueueItem {
  queueItemId: string;
  queueId: string | null;
  queueName: string | null;
  enteredOn: string | null;
  enteredOnLabel: string | null;
  workerId: string | null;
  workerName: string | null;
  stateLabel: string | null;
  /** A resolved record keeps its queue item as an inactive row, so the current
   *  queue is the active one or none at all. */
  isActive: boolean;
}

/** Status of a plt_urd_diagnosticrequest row. */
export type RequestStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "nodata"
  | "error"
  | "timeout";

export interface DiagnosticRequest {
  id: string;
  status: RequestStatus;
  statusMessage: string | null;
  eventCount: number | null;
  isTruncated: boolean;
  completedOn: string | null;
}

/** A row of plt_urd_diagnosticevent: one Application Insights trace. */
export interface DiagnosticEvent {
  id: string;
  timestamp: string | null;
  timestampLabel: string | null;
  /** The order the flow wrote the traces in. Several stages share a timestamp once
   *  it is stored at second precision, so this is what keeps them in order. */
  sequence: number | null;
  subscenario: string | null;
  channelType: string | null;
  part: number | null;
  partCount: number | null;
  queueId: string | null;
  queueName: string | null;
  workstreamId: string | null;
  outcome: string | null;
  additionalInfo: string | null;
  result: string | null;
  payload: string | null;
}

/** Several diagnostic events merged into one logical stage.
 *  Route to queue arrives split across [Part n of m] traces; those are merged here. */
export interface Stage {
  key: string;
  subscenario: string;
  sequence: number | null;
  timestamp: string | null;
  timestampLabel: string | null;
  durationMs: number | null;
  queueName: string | null;
  outcome: string | null;
  ruleSetName: string | null;
  ruleHitPolicy: string | null;
  rules: RuleExecution[];
  parts: number;
  workItemDetails: WorkItemDetails | null;
  assignment: AssignmentDetails | null;
  payloads: string[];
}

export interface RuleExecution {
  ruleId: string | null;
  order: number | null;
  name: string | null;
  condition: string | null;
  status: RuleStatus;
  output: string | null;
}

/** Classification writes a string status, route to queue writes a number.
 *  Both are normalised to this. */
export type RuleStatus = "applied" | "processed" | "notProcessed" | "unknown";

export interface WorkItemDetails {
  sessionId: string | null;
  queueId: string | null;
  workstreamId: string | null;
  requiredCapacityUnits: number | null;
  allowedPresences: string[];
  requiredSkills: string[];
  capacityProfiles: string[];
  reservationType: string | null;
  queueAssignedOn: string | null;
}

export interface AssignmentDetails {
  method: string | null;
  reason: string | null;
  isAgentAssigned: boolean;
  rulesExecuted: Record<string, string | null> | null;
  /** Only present once an agent was picked: who they were and what they had at
   *  that moment, which is what explains why routing chose them. */
  agent: AssignedAgent | null;
}

export interface AssignedAgent {
  agentId: string | null;
  skills: string[];
  presence: string | null;
  availableCapacityUnits: number | null;
  capacityProfiles: string[];
  activeSessionCount: number | null;
}