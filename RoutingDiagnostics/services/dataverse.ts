/** Every Dataverse read the control makes.
 *  Nothing here touches Application Insights: that goes through diagnostics.ts. */

import {
  LiveWorkItem,
  QueueItem,
  RoutedSubject,
  Session,
  SessionParticipant,
  Outcome,
} from "../types";

type WebApi = ComponentFramework.WebApi;

const LWI_SELECT = [
  "activityid",
  "subject",
  "statecode",
  "statuscode",
  "msdyn_statuschangereason",
  "msdyn_createdon",
  "msdyn_closedon",
  "msdyn_firstwaitstartedon",
  "msdyn_startedon",
  "msdyn_isagentaccepted",
  "msdyn_isabandoned",
  "_msdyn_activeagentid_value",
  "msdyn_ocliveworkitemid",
  "_msdyn_routableobjectid_value",
  "msdyn_routableobjectlogicalname",
  "_msdyn_liveworkstreamid_value",
  "_msdyn_cdsqueueid_value",
  "_msdyn_queueitemid_value",
].join(",");

/** Formatted-value and lookup-name annotations come back on these keys. */
const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
const LOOKUP_NAME = "@OData.Community.Display.V1.FormattedValue";

function str(row: ComponentFramework.WebApi.Entity, key: string): string | null {
  const v = row[key];
  return v === undefined || v === null || v === "" ? null : String(v);
}

function formatted(row: ComponentFramework.WebApi.Entity, key: string): string | null {
  return str(row, `${key}${FORMATTED}`);
}

function bool(row: ComponentFramework.WebApi.Entity, key: string): boolean {
  return row[key] === true;
}

function toLiveWorkItem(row: ComponentFramework.WebApi.Entity): LiveWorkItem {
  return {
    activityid: String(row["activityid"]),
    subject: str(row, "subject"),
    statecode: Number(row["statecode"] ?? 0),
    statecodeLabel: formatted(row, "statecode"),
    statusCodeLabel: formatted(row, "statuscode"),
    statusChangeReason: formatted(row, "msdyn_statuschangereason"),
    createdOn: str(row, "msdyn_createdon"),
    closedOn: str(row, "msdyn_closedon"),
    firstWaitStartedOn: str(row, "msdyn_firstwaitstartedon"),
    startedOn: str(row, "msdyn_startedon"),
    createdOnLabel: formatted(row, "msdyn_createdon"),
    closedOnLabel: formatted(row, "msdyn_closedon"),
    isAgentAccepted: bool(row, "msdyn_isagentaccepted"),
    isAbandoned: bool(row, "msdyn_isabandoned"),
    activeAgentId: str(row, "_msdyn_activeagentid_value"),
    activeAgentName: str(row, `_msdyn_activeagentid_value${LOOKUP_NAME}`),
    conversationId: str(row, "msdyn_ocliveworkitemid"),
    routableObjectId: str(row, "_msdyn_routableobjectid_value"),
    routableObjectLogicalName: str(row, "msdyn_routableobjectlogicalname"),
    workstreamId: str(row, "_msdyn_liveworkstreamid_value"),
    workstreamName: str(row, `_msdyn_liveworkstreamid_value${LOOKUP_NAME}`),
    queueId: str(row, "_msdyn_cdsqueueid_value"),
    queueName: str(row, `_msdyn_cdsqueueid_value${LOOKUP_NAME}`),
    queueItemId: str(row, "_msdyn_queueitemid_value"),
  };
}

/** What happened to this routing attempt, in the words a support engineer would use.
 *
 *  No single field answers this. msdyn_statereason looks like it does, and reads
 *  "Awaiting agent assignment" in plain English, but it is a free-text column that
 *  routing writes once and never revises: a closed, long since handled item still
 *  carries the text it was given when it first entered the queue. Reading it reports
 *  weeks-old state as current, so it is not fetched at all.
 *
 *  The state is derived instead from the columns the platform does maintain. Which
 *  of them is set tells the stage apart:
 *
 *    open, no active agent          -> still queued, nobody has been picked
 *    active agent set, not accepted -> offered to someone, waiting on them
 *    accepted, not closed           -> being worked
 *
 *  Whether an offer was ever made is the one thing the live work item cannot say on
 *  its own, so the caller passes whether a session exists. */
export function describeOutcome(item: LiveWorkItem, hadSession: boolean): Outcome {
  const closed = item.statecode !== 0 || item.closedOn !== null;

  if (!closed && item.activeAgentId === null) {
    return {
      kind: "waitingAssignment",
      label: "Awaiting assignment",
      detail: hadSession
        ? "Was offered before, nobody took it"
        : "Never offered to an agent",
    };
  }
  // Acceptance is a conversation idea. Record routing in push mode assigns the
  // record outright and never sets msdyn_isagentaccepted, so reading that flag
  // there would report work that an agent already owns as still waiting.
  const isRecordRouting = item.routableObjectLogicalName !== null;

  if (!closed && !isRecordRouting && !item.isAgentAccepted) {
    return {
      kind: "waitingAcceptance",
      label: "Awaiting acceptance",
      detail: item.activeAgentName
        ? `Offered to ${item.activeAgentName}`
        : "Offered, not yet accepted",
    };
  }
  if (!closed) {
    return {
      kind: "inConversation",
      label: isRecordRouting ? "Assigned" : "Being worked",
      detail: item.activeAgentName,
    };
  }
  if (item.isAbandoned) {
    return {
      kind: "abandoned",
      label: "Abandoned",
      detail: item.statusChangeReason ?? item.statusCodeLabel,
    };
  }
  return {
    kind: "closed",
    label: "Closed",
    detail: item.statusChangeReason ?? item.statusCodeLabel,
  };
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** One page of live work items, plus the link that continues the read. */
export interface LiveWorkItemPage {
  items: LiveWorkItem[];
  nextLink: string | null;
}

/** Live work items, newest first.
 *
 *  Pages are accumulated by the caller and regrouped over the whole accumulation,
 *  so an attempt landing on a later page joins its record's group rather than
 *  creating a second one.
 *
 *  A pasted identifier is matched against the three ids a person can have in hand:
 *  the conversation id shown on the Conversation form, the live work item's own
 *  activity id, and the id of the record that was routed. Searching by id ignores
 *  the time window, because someone who has the id already knows what they want
 *  and should not have to guess how old it is. */
export async function fetchLiveWorkItems(
  webAPI: WebApi,
  sinceIso: string | null,
  search: string | null,
  pageSize = 250
): Promise<LiveWorkItemPage> {
  const term = search?.trim() ?? "";
  const byId = GUID.test(term);
  const filters: string[] = [];

  if (byId) {
    const id = term.replace(/[{}]/g, "");
    filters.push(
      `(msdyn_ocliveworkitemid eq '${id}'` +
        ` or activityid eq ${id}` +
        ` or _msdyn_routableobjectid_value eq ${id})`
    );
  } else {
    if (sinceIso) filters.push(`msdyn_createdon ge ${sinceIso}`);
    if (term) filters.push(`contains(subject,'${term.replace(/'/g, "''")}')`);
  }

  const query =
    `?$select=${LWI_SELECT}` +
    (filters.length > 0 ? `&$filter=${filters.join(" and ")}` : "") +
    `&$orderby=msdyn_createdon desc`;

  return readPage(webAPI, query, pageSize);
}

/** Continues a read from the link the previous page returned.
 *  nextLink comes back as an absolute URL, but the Web API expects options that
 *  start at the query string, so only that part is passed on. */
export async function fetchMoreLiveWorkItems(
  webAPI: WebApi,
  nextLink: string,
  pageSize = 250
): Promise<LiveWorkItemPage> {
  const start = nextLink.indexOf("?");
  const options = start >= 0 ? nextLink.substring(start) : nextLink;
  return readPage(webAPI, options, pageSize);
}

async function readPage(
  webAPI: WebApi,
  options: string,
  pageSize: number
): Promise<LiveWorkItemPage> {
  const result = await webAPI.retrieveMultipleRecords(
    "msdyn_ocliveworkitem",
    options,
    pageSize
  );
  const next = (result as { nextLink?: string }).nextLink;
  return {
    items: result.entities.map(toLiveWorkItem),
    nextLink: next && next.length > 0 ? next : null,
  };
}

/** Group live work items by what was routed.
 *  A case produces one group with several attempts; a conversation on a chat or
 *  voice channel has no routed record, so it is its own group. */
export function groupByRoutedSubject(
  items: LiveWorkItem[],
  sessionsByItem: Map<string, Session[]>
): RoutedSubject[] {
  const groups = new Map<string, LiveWorkItem[]>();

  for (const item of items) {
    const key = item.routableObjectId ?? item.activityid;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const subjects: RoutedSubject[] = [];
  groups.forEach((bucket, key) => {
    bucket.sort((a, b) => compareIso(b.createdOn, a.createdOn));
    const latest = bucket[0];
    const hadSession = (sessionsByItem.get(latest.activityid) ?? []).length > 0;
    subjects.push({
      key,
      title: latest.subject ?? "(no subject)",
      logicalName: latest.routableObjectLogicalName,
      recordId: latest.routableObjectId,
      workstreamName: latest.workstreamName,
      items: bucket,
      latest,
      outcome: describeOutcome(latest, hadSession),
    });
  });

  subjects.sort((a, b) => compareIso(b.latest.createdOn, a.latest.createdOn));
  return subjects;
}


/** Dataverse caps the number of conditions in one query, so an id list is read in
 *  slices and the results are concatenated. The slice is deliberately small: the
 *  limit counts conditions across the whole query, not just the or-list. */
const ID_CHUNK = 40;

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function readByIds(
  webAPI: WebApi,
  entity: string,
  ids: string[],
  buildQuery: (filter: string) => string,
  field: string
): Promise<ComponentFramework.WebApi.Entity[]> {
  const rows: ComponentFramework.WebApi.Entity[] = [];
  for (const slice of chunk(ids, ID_CHUNK)) {
    const filter = slice.map((id) => `${field} eq ${id}`).join(" or ");
    const result = await webAPI.retrieveMultipleRecords(entity, buildQuery(filter));
    rows.push(...result.entities);
  }
  return rows;
}

export async function fetchSessions(
  webAPI: WebApi,
  liveWorkItemIds: string[]
): Promise<Session[]> {
  if (liveWorkItemIds.length === 0) return [];

  const rows = await readByIds(
    webAPI,
    "msdyn_ocsession",
    liveWorkItemIds,
    (filter) =>
      "?$select=activityid,_msdyn_liveworkitemid_value,msdyn_sessioncreatedon," +
      "msdyn_sessionclosedon,msdyn_closurereason,msdyn_queueassignedon," +
      "msdyn_queueassignedreason,msdyn_agentassignedon,msdyn_agentacceptedon" +
      `&$filter=${filter}` +
      "&$orderby=msdyn_sessioncreatedon asc",
    "_msdyn_liveworkitemid_value"
  );
  const sessions = rows.map((row) => ({
    activityid: String(row["activityid"]),
    liveWorkItemId: str(row, "_msdyn_liveworkitemid_value"),
    createdOn: str(row, "msdyn_sessioncreatedon"),
    closedOn: str(row, "msdyn_sessionclosedon"),
    createdOnLabel: formatted(row, "msdyn_sessioncreatedon"),
    closedOnLabel: formatted(row, "msdyn_sessionclosedon"),
    closureReason: formatted(row, "msdyn_closurereason"),
    queueAssignedOn: str(row, "msdyn_queueassignedon"),
    queueAssignedReason: formatted(row, "msdyn_queueassignedreason"),
    agentAssignedOn: str(row, "msdyn_agentassignedon"),
    agentAcceptedOn: str(row, "msdyn_agentacceptedon"),
    participants: [] as SessionParticipant[],
  }));

  const participants = await fetchParticipants(
    webAPI,
    sessions.map((s) => s.activityid)
  );
  for (const session of sessions) {
    session.participants = participants.filter((p) => p.sessionId === session.activityid);
  }
  return sessions;
}

interface ParticipantRow extends SessionParticipant {
  sessionId: string | null;
}

/** addedOn set with joinedOn still null is the signature of an offer that timed out.
 *  It is the only place that difference is recorded. */
async function fetchParticipants(
  webAPI: WebApi,
  sessionIds: string[]
): Promise<ParticipantRow[]> {
  if (sessionIds.length === 0) return [];

  const rows = await readByIds(
    webAPI,
    "msdyn_sessionparticipant",
    sessionIds,
    (filter) =>
      "?$select=msdyn_sessionparticipantid,_msdyn_agentid_value," +
      "_msdyn_omnichannelsession_value,msdyn_mode,msdyn_assignreason," +
      "msdyn_addedon,msdyn_joinedon,msdyn_lefton,msdyn_leftonreason," +
      "msdyn_iscapacityblocking" +
      `&$filter=${filter}`,
    "_msdyn_omnichannelsession_value"
  );
  return rows.map((row) => ({
    id: String(row["msdyn_sessionparticipantid"]),
    sessionId: str(row, "_msdyn_omnichannelsession_value"),
    agentId: str(row, "_msdyn_agentid_value"),
    agentName: str(row, `_msdyn_agentid_value${LOOKUP_NAME}`),
    mode: formatted(row, "msdyn_mode"),
    assignReason: str(row, "msdyn_assignreason"),
    addedOn: str(row, "msdyn_addedon"),
    joinedOn: str(row, "msdyn_joinedon"),
    joinedOnLabel: formatted(row, "msdyn_joinedon"),
    leftOn: str(row, "msdyn_lefton"),
    leftOnReason: str(row, "msdyn_leftonreason"),
    isCapacityBlocking: bool(row, "msdyn_iscapacityblocking"),
  }));
}

export async function fetchQueueItems(
  webAPI: WebApi,
  objectIds: string[]
): Promise<QueueItem[]> {
  if (objectIds.length === 0) return [];

  const rows = await readByIds(
    webAPI,
    "queueitem",
    objectIds,
    (filter) =>
      "?$select=queueitemid,_queueid_value,enteredon,_workerid_value,statecode" +
      `&$filter=${filter}` +
      "&$orderby=enteredon desc",
    "_objectid_value"
  );
  return rows.map((row) => ({
    queueItemId: String(row["queueitemid"]),
    queueId: str(row, "_queueid_value"),
    queueName: str(row, `_queueid_value${LOOKUP_NAME}`),
    enteredOn: str(row, "enteredon"),
    enteredOnLabel: formatted(row, "enteredon"),
    workerId: str(row, "_workerid_value"),
    workerName: str(row, `_workerid_value${LOOKUP_NAME}`),
    stateLabel: formatted(row, "statecode"),
    isActive: row["statecode"] === 0,
  }));
}

/** The primary key and primary name of every table whose ids appear in a trace.
 *  Application Insights logs ids and nothing else, so each one is looked up here. */
const NAME_FIELDS: Record<string, { key: string; name: string }> = {
  queue: { key: "queueid", name: "name" },
  msdyn_liveworkstream: { key: "msdyn_liveworkstreamid", name: "msdyn_name" },
  characteristic: { key: "characteristicid", name: "name" },
  systemuser: { key: "systemuserid", name: "fullname" },
  msdyn_decisionruleset: { key: "msdyn_decisionrulesetid", name: "msdyn_name" },
};

export function isResolvableEntity(entity: string): boolean {
  return entity in NAME_FIELDS;
}

/** Names for a set of ids in one table. Ids that no longer resolve are simply
 *  absent from the map, and the caller keeps showing the raw id. */
export async function fetchNames(
  webAPI: WebApi,
  entity: string,
  ids: string[]
): Promise<Map<string, string>> {
  const fields = NAME_FIELDS[entity];
  const names = new Map<string, string>();
  if (!fields || ids.length === 0) return names;

  const rows = await readByIds(
    webAPI,
    entity,
    ids,
    (filter) => `?$select=${fields.key},${fields.name}&$filter=${filter}`,
    fields.key
  );

  for (const row of rows) {
    const id = str(row, fields.key);
    const name = str(row, fields.name);
    if (id && name) names.set(id.toLowerCase(), name);
  }
  return names;
}

/** Skills a user carries, read from the schedule tables unified routing matches on.
 *
 *  The assignment trace names the agent but usually logs an empty skill list, so the
 *  only place the skills exist is Dataverse: a user is a bookable resource, and the
 *  resource carries characteristics. The trace's agent id is sometimes the user and
 *  sometimes the resource, so both are accepted. */
export async function fetchAgentSkills(
  webAPI: WebApi,
  agentId: string
): Promise<string[]> {
  const resources = await webAPI.retrieveMultipleRecords(
    "bookableresource",
    "?$select=bookableresourceid" +
      `&$filter=_userid_value eq ${agentId} or bookableresourceid eq ${agentId}`
  );

  const resourceIds = resources.entities.map((row) => String(row["bookableresourceid"]));
  if (resourceIds.length === 0) return [];

  const rows = await readByIds(
    webAPI,
    "bookableresourcecharacteristic",
    resourceIds,
    (filter) =>
      "?$select=bookableresourcecharacteristicid" +
      "&$expand=characteristic($select=name)" +
      `&$filter=${filter}`,
    "_resource_value"
  );

  const names = rows
    .map((row) => {
      const characteristic = row["characteristic"] as { name?: string } | undefined;
      return characteristic?.name ?? null;
    })
    .filter((name): name is string => Boolean(name));

  return Array.from(new Set(names)).sort();
}

export function compareIso(a: string | null, b: string | null): number {
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  return ta - tb;
}