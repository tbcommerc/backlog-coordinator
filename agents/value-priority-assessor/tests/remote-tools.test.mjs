import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { runCli } from "../.opencode/lib/run-cli.js"

test("HTTP tool bridge uses no Python and preserves idempotency", async () => {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    requests.push({body: JSON.parse(body), auth: req.headers.authorization, path: req.url})
    res.writeHead(200, {"Content-Type": "application/json"})
    res.end(JSON.stringify({assessment: {raw_score: 10}}))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const saved = {...process.env}
  try {
    process.env.PRIORITISER_TOOL_MODE = "http"
    process.env.PRIORITISER_TOOL_BASE_URL = `http://127.0.0.1:${server.address().port}`
    process.env.PRIORITISER_TOOL_TOKEN = "synthetic-scoped-token"
    process.env.PRIORITISER_TOOL_RUN_ID = "00000000-0000-4000-8000-000000000001"
    process.env.PRIORITISER_PYTHON = "/nonexistent/python"
    const argv = ["assess-strategy", "SYNTHETIC-1", "--answers", '{"synthetic":"direct"}',
      "--rationale", "Synthetic", "--actor", "strategy-analyst"]
    const first = JSON.parse(await runCli("/no/project", argv))
    assert.equal(first.assessment.raw_score, 10)
    await runCli("/no/project", argv)
    assert.equal(requests[0].body.call_id, requests[1].body.call_id)
    assert.equal(requests[0].body.operation, "strategy-assess")
    assert.equal(requests[0].body.task_key, "SYNTHETIC-1")
    assert.equal(requests[0].auth, "Bearer synthetic-scoped-token")
    assert.equal(requests[0].path, "/internal/tools/v1/call")
    assert.ok(!("actor" in requests[0].body))
    await assert.rejects(runCli("/no/project", ["attribution-run"]), /remote_tool_operation_forbidden/)
    process.env.PRIORITISER_TOOL_MODE = "unknown"
    assert.throws(() => runCli("/no/project", argv), /remote_tool_mode_invalid/)
  } finally {
    process.env = saved
    await new Promise(resolve => server.close(resolve))
  }
})

test("redirect does not forward a scoped credential or invoke local CLI", async () => {
  let foreignCalls = 0
  const foreign = createServer((req, res) => { foreignCalls++; res.end("unsafe") })
  await new Promise(resolve => foreign.listen(0, "127.0.0.1", resolve))
  const redirect = createServer((req, res) => {
    res.writeHead(307, {Location: `http://127.0.0.1:${foreign.address().port}/`})
    res.end()
  })
  await new Promise(resolve => redirect.listen(0, "127.0.0.1", resolve))
  const saved = {...process.env}
  try {
    Object.assign(process.env, {PRIORITISER_TOOL_MODE: "http", PRIORITISER_TOOL_TOKEN: "synthetic",
      PRIORITISER_TOOL_RUN_ID: "00000000-0000-4000-8000-000000000001",
      PRIORITISER_TOOL_BASE_URL: `http://127.0.0.1:${redirect.address().port}`})
    await assert.rejects(runCli("/no/project", ["rubric"]), /remote_tool_transport_unavailable/)
    assert.equal(foreignCalls, 0)
  } finally {
    process.env = saved
    await Promise.all([new Promise(r => foreign.close(r)), new Promise(r => redirect.close(r))])
  }
})
