function normalizedKind(kind) {
  const value = typeof kind === 'string' ? kind.trim() : '';
  if (!value) throw new TypeError('Request kind must be a non-empty string');
  return value;
}

function normalizedTaskId(taskId) {
  if (typeof taskId === 'number') {
    if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new TypeError('Task ID must be a positive integer');
    return String(taskId);
  }
  if (typeof taskId === 'string' && /^[1-9]\d*$/.test(taskId.trim())) {
    const numericId = Number(taskId.trim());
    if (Number.isSafeInteger(numericId)) return String(numericId);
  }
  throw new TypeError('Task ID must be a positive integer');
}

function opaqueToken() {
  return Object.freeze(Object.create(null));
}

export function createTaskCardRequestGate() {
  const activeByKind = new Map();
  const recordByToken = new Map();

  function start(kind, taskId) {
    const kindKey = normalizedKind(kind);
    const taskKey = normalizedTaskId(taskId);
    const previous = activeByKind.get(kindKey);
    if (previous) {
      previous.controller.abort();
      recordByToken.delete(previous.token);
    }

    const controller = new AbortController();
    const token = opaqueToken();
    const record = { kind: kindKey, taskId: taskKey, controller, token };
    activeByKind.set(kindKey, record);
    recordByToken.set(token, record);
    return Object.freeze({ token, signal: controller.signal });
  }

  function isCurrent(token, taskId) {
    const record = recordByToken.get(token);
    if (!record || record.controller.signal.aborted) return false;

    let taskKey;
    try {
      taskKey = normalizedTaskId(taskId);
    } catch {
      return false;
    }
    return record.taskId === taskKey && activeByKind.get(record.kind) === record;
  }

  function finish(token) {
    const record = recordByToken.get(token);
    if (!record) return false;
    recordByToken.delete(token);
    if (activeByKind.get(record.kind) !== record) return false;
    activeByKind.delete(record.kind);
    return true;
  }

  function cancelAll() {
    const records = [...activeByKind.values()];
    activeByKind.clear();
    recordByToken.clear();
    records.forEach(record => record.controller.abort());
    return records.length;
  }

  return Object.freeze({ start, isCurrent, finish, cancelAll });
}

export class TaskCardRequestGate {
  constructor() {
    const gate = createTaskCardRequestGate();
    this.start = gate.start;
    this.isCurrent = gate.isCurrent;
    this.finish = gate.finish;
    this.cancelAll = gate.cancelAll;
    Object.freeze(this);
  }
}
