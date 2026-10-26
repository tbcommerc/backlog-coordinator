function positiveInteger(value) {
  const candidate = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(candidate)) return null;
  const id = Number(candidate);
  return Number.isSafeInteger(id) ? id : null;
}

function requiredTaskId(taskId) {
  const id = positiveInteger(taskId);
  if (id === null) throw new TypeError('Task ID must be a positive integer');
  return id;
}

function queryParamsFromHashOrQuery(hashOrQuery) {
  if (hashOrQuery instanceof URLSearchParams) return new URLSearchParams(hashOrQuery);
  if (typeof hashOrQuery !== 'string') return null;

  const value = hashOrQuery.trim();
  if (!value) return null;
  const questionMark = value.indexOf('?');
  let query;
  if (questionMark >= 0) query = value.slice(questionMark + 1);
  else if (value.startsWith('?')) query = value.slice(1);
  else if (!value.startsWith('#') && value.includes('=')) query = value;
  else return null;

  const fragmentMark = query.indexOf('#');
  if (fragmentMark >= 0) query = query.slice(0, fragmentMark);
  return new URLSearchParams(query);
}

export function parseCommentTarget(hashOrQuery) {
  const params = queryParamsFromHashOrQuery(hashOrQuery);
  if (!params) return null;
  return positiveInteger(params.get('comment'));
}

function emptyDraft(taskId) {
  return {
    taskId,
    text: '',
    mentionedUserIds: [],
    reply: null,
  };
}

function publicSnapshot(draft) {
  if (!draft) return null;
  const reply = draft.reply ? Object.freeze({ ...draft.reply }) : null;
  return Object.freeze({
    taskId: draft.taskId,
    text: draft.text,
    mentionedUserIds: Object.freeze([...draft.mentionedUserIds]),
    reply,
  });
}

function normalizeMentionedUserIds(userIds) {
  if (!userIds || typeof userIds === 'string' || typeof userIds[Symbol.iterator] !== 'function') return [];
  const unique = new Set();
  for (const value of userIds) {
    const id = positiveInteger(value);
    if (id !== null) unique.add(id);
  }
  return [...unique];
}

function normalizeReply(replyOrId, name) {
  const source = replyOrId && typeof replyOrId === 'object'
    ? replyOrId
    : { id: replyOrId, name };
  const id = positiveInteger(source.id);
  if (id === null) throw new TypeError('Reply comment ID must be a positive integer');
  const replyName = source.name ?? source.userName ?? source.user_name ?? '';
  return { id, name: String(replyName).trim() };
}

export function createTaskCommentDraftSession() {
  const drafts = new Map();
  let currentTaskId = null;

  function activeDraft() {
    if (currentTaskId === null) throw new Error('Call begin(taskId) before changing a comment draft');
    return drafts.get(currentTaskId);
  }

  function begin(taskId) {
    const id = requiredTaskId(taskId);
    currentTaskId = id;
    if (!drafts.has(id)) drafts.set(id, emptyDraft(id));
    return publicSnapshot(drafts.get(id));
  }

  function snapshot(taskId = currentTaskId) {
    const id = positiveInteger(taskId);
    return id === null ? null : publicSnapshot(drafts.get(id));
  }

  function current() {
    return snapshot(currentTaskId);
  }

  function setText(text) {
    const draft = activeDraft();
    draft.text = String(text ?? '');
    return publicSnapshot(draft);
  }

  function setMentionedUserIds(userIds) {
    const draft = activeDraft();
    draft.mentionedUserIds = normalizeMentionedUserIds(userIds);
    return publicSnapshot(draft);
  }

  function setReply(replyOrId, name = '') {
    const draft = activeDraft();
    draft.reply = normalizeReply(replyOrId, name);
    return publicSnapshot(draft);
  }

  function clearReply() {
    const draft = activeDraft();
    draft.reply = null;
    return publicSnapshot(draft);
  }

  function hasChanges(taskId = currentTaskId) {
    const id = positiveInteger(taskId);
    if (id === null) return false;
    const draft = drafts.get(id);
    return Boolean(draft && (draft.text !== '' || draft.mentionedUserIds.length || draft.reply));
  }

  function clear(taskId) {
    const id = positiveInteger(taskId);
    if (id === null) return false;
    const removed = drafts.delete(id);
    if (currentTaskId === id) currentTaskId = null;
    return removed;
  }

  function clearAll() {
    const count = drafts.size;
    drafts.clear();
    currentTaskId = null;
    return count;
  }

  return Object.freeze({
    begin,
    snapshot,
    current,
    setText,
    setMentionedUserIds,
    setReply,
    clearReply,
    hasChanges,
    clear,
    clearAll,
  });
}

export class TaskCommentDraftSession {
  constructor() {
    const session = createTaskCommentDraftSession();
    this.begin = session.begin;
    this.snapshot = session.snapshot;
    this.current = session.current;
    this.setText = session.setText;
    this.setMentionedUserIds = session.setMentionedUserIds;
    this.setReply = session.setReply;
    this.clearReply = session.clearReply;
    this.hasChanges = session.hasChanges;
    this.clear = session.clear;
    this.clearAll = session.clearAll;
    Object.freeze(this);
  }
}
