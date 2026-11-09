// Only trusted runtime configuration supplies the route, run and scoped token.
// No Python process, shell, arbitrary command or provider key is needed here.
import { createHash } from "node:crypto"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

export async function runRemoteCli(argv) {
  const mapping = {"rubric": "rubric-read", "assessments": "assessments-read",
    "assess-strategy": "strategy-assess", "assess-dependencies": "dependency-assess"}
  const operation = mapping[argv[0]]
  if (!operation) throw new Error("remote_tool_operation_forbidden")
  const base = new URL(process.env.PRIORITISER_TOOL_BASE_URL || "")
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
      base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("remote_tool_route_invalid")
  }
  const token = process.env.PRIORITISER_TOOL_TOKEN
  const run = process.env.PRIORITISER_TOOL_RUN_ID
  if (!token || !run) throw new Error("remote_tool_grant_missing")
  const request = {run_id: run, operation}
  let index = 1
  if (operation !== "rubric-read") request.task_key = argv[index++]
  const names = {"--answers": "answers", "--teams": "teams", "--rationale": "rationale", "--factor": "factor"}
  while (index < argv.length) {
    const flag = argv[index++], value = argv[index++]
    if (value === undefined) throw new Error("remote_tool_arguments_invalid")
    if (flag === "--actor") continue // Identity is exclusively taken from the grant.
    if (flag === "--evidence") {
      request.evidence = value.split(",").map(s => s.trim()).filter(Boolean)
    } else if (names[flag]) {
      request[names[flag]] = ["--answers", "--teams"].includes(flag) ? JSON.parse(value) : value
    } else {
      throw new Error("remote_tool_arguments_invalid")
    }
  }
  request.call_id = createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex")
  let response
  try {
    response = await fetch(new URL("/internal/tools/v1/call", base), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: {"Content-Type": "application/json", "Authorization": `Bearer ${token}`},
      body: JSON.stringify(request),
    })
  } catch {
    throw new Error("remote_tool_transport_unavailable")
  }
  if (!response.ok) throw new Error(`remote_tool_http_${response.status}`)
  return JSON.stringify(await response.json())
}
