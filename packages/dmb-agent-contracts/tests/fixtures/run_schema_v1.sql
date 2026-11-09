-- Frozen facade schema before optional retry ancestry (2026-11-04).

CREATE TABLE agent_run_events (
	run_id VARCHAR(36) NOT NULL,
	sequence INTEGER NOT NULL,
	type VARCHAR(32) NOT NULL,
	occurred_at DATETIME NOT NULL,
	PRIMARY KEY (run_id, sequence)
)

;


CREATE TABLE agent_runs (
	id VARCHAR(36) NOT NULL,
	caller VARCHAR(128) NOT NULL,
	actor VARCHAR(128) NOT NULL,
	"key" VARCHAR(128) NOT NULL,
	request_hash VARCHAR(64) NOT NULL,
	input JSON,
	profile JSON NOT NULL,
	source JSON NOT NULL,
	operation VARCHAR(80) NOT NULL,
	conversation_ref VARCHAR(128),
	trusted_context JSON NOT NULL,
	status VARCHAR(24) NOT NULL,
	version INTEGER NOT NULL,
	delivery VARCHAR(24) NOT NULL,
	dispatch_ref VARCHAR(36),
	created_at DATETIME NOT NULL,
	deadline_at DATETIME NOT NULL,
	lease_until DATETIME,
	finished_at DATETIME,
	cancel_requested_at DATETIME,
	result JSON,
	payload_hash VARCHAR(64),
	error VARCHAR(64),
	ack_at DATETIME,
	result_expired INTEGER NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_agent_run_idempotency UNIQUE (caller, actor, "key")
)

;
