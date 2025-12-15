// Throwaway e2e driver: exercises the live backend HTTP API end-to-end
// against the library.sqlite fixture, mirroring what the frontend would do.
const BASE = "http://localhost:4000";
const results = [];

function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + JSON.stringify(detail).slice(0, 500) : ""}`);
}

async function json(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { status: res.status, data };
}

async function sse(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const events = [];
  let finalEvent = null;
  let errorEvent = null;

  if (!res.body) {
    const text = await res.text();
    return { status: res.status, events, finalEvent, errorEvent, raw: text };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventName = "message";
      let dataLines = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join("\n");
      let parsed = dataStr;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        // leave as string
      }
      events.push({ event: eventName, data: parsed });
      if (eventName === "final") finalEvent = parsed;
      if (eventName === "error") errorEvent = parsed;
    }
  }

  return { status: res.status, events, finalEvent, errorEvent };
}

async function main() {
  const out = {};

  // --- Health ---
  const health = await json("GET", "/health");
  log("GET /health", health.status === 200 && health.data.status === "ok", health.data);

  // --- Register + login ---
  const email = `e2e-${Date.now()}@example.com`;
  const password = "correct-horse-battery-staple";
  const register = await json("POST", "/auth/register", { email, password });
  log("POST /auth/register", register.status === 200 && !!register.data.token, { status: register.status });
  const token = register.data.token;

  const login = await json("POST", "/auth/login", { email, password });
  log("POST /auth/login", login.status === 200 && !!login.data.token, { status: login.status });

  // --- Register sqlite source ---
  const dbPath = process.argv[2];
  if (!dbPath) throw new Error("Usage: node drive.mjs <sqlite-path>");
  const source = await json("POST", "/sources/db", { kind: "sqlite", connectionString: dbPath }, token);
  log("POST /sources/db (sqlite)", source.status === 200 && !!source.data.sourceId, {
    status: source.status,
    tables: source.data?.profile?.tables?.map((t) => t.name),
  });
  out.sourceProfile = source.data?.profile;
  const sourceId = source.data?.sourceId;

  const declaredRels = (source.data?.profile?.relationships ?? []).filter((r) => r.confidence === "declared");
  log(
    "sqlite FK relationships are 'declared'",
    declaredRels.length >= 3,
    { count: declaredRels.length, relationships: declaredRels },
  );

  // --- Conversational question ---
  const convoAsk = await sse(
    "POST",
    `/sources/${sourceId}/ask`,
    { question: "Hi, what can you tell me about this data?" },
    token,
  );
  const convoAnswer = convoAsk.finalEvent;
  log("conversational ask -> answerType conversation", convoAnswer?.answerType === "conversation", {
    answerType: convoAnswer?.answerType,
    hasSql: !!convoAnswer?.sql,
    hasChart: !!convoAnswer?.chartSpec,
    events: convoAsk.events.map((e) => e.event),
  });
  const conversationId = convoAnswer?.conversationId;
  out.conversationId = conversationId;
  out.convoAnswer = convoAnswer;

  // --- Data question requiring a JOIN ---
  const dataAsk = await sse(
    "POST",
    `/sources/${sourceId}/ask`,
    { question: "Which members have the most active (not yet returned) loans?", conversationId },
    token,
  );
  const dataAnswer = dataAsk.finalEvent;
  log("data question -> answerType analysis", dataAnswer?.answerType === "analysis", {
    answerType: dataAnswer?.answerType,
    sql: dataAnswer?.sql,
    hasChart: !!dataAnswer?.chartSpec,
    events: dataAsk.events.map((e) => e.event),
  });
  out.dataAnswer = dataAnswer;
  out.dataAskEvents = dataAsk.events.map((e) => e.event);

  const joinsTables = dataAnswer?.sql && /loans/i.test(dataAnswer.sql) && /members/i.test(dataAnswer.sql);
  log("data question SQL joins loans + members", !!joinsTables, { sql: dataAnswer?.sql });

  // --- Follow-up question ---
  const followupAsk = await sse(
    "POST",
    `/sources/${sourceId}/ask`,
    { question: "Tell me more about the first one.", conversationId },
    token,
  );
  const followupAnswer = followupAsk.finalEvent;
  log("follow-up question resolved (has answer)", !!followupAnswer?.narrative, {
    answerType: followupAnswer?.answerType,
    narrative: followupAnswer?.narrative,
    sql: followupAnswer?.sql,
  });
  out.followupAnswer = followupAnswer;
  out.followupAskEvents = followupAsk.events.map((e) => e.event);

  // --- Conversations list/get ---
  const convList = await json("GET", "/conversations", undefined, token);
  log("GET /conversations", convList.status === 200 && Array.isArray(convList.data), {
    count: convList.data?.length,
  });

  const convGet = await json("GET", `/conversations/${conversationId}`, undefined, token);
  log("GET /conversations/:id", convGet.status === 200 && Array.isArray(convGet.data?.messages), {
    messageCount: convGet.data?.messages?.length,
  });
  out.conversationDetail = convGet.data;

  // --- Reports: from conversation ---
  const reportFromConvo = await sse("POST", "/reports", { conversationId }, token);
  log("POST /reports (conversationId)", !!reportFromConvo.finalEvent?.sections, {
    status: reportFromConvo.status,
    title: reportFromConvo.finalEvent?.title,
    sectionCount: reportFromConvo.finalEvent?.sections?.length,
    error: reportFromConvo.errorEvent,
  });
  out.reportFromConvo = reportFromConvo.finalEvent;

  // --- Reports: fresh from source ---
  const reportFromSource = await sse(
    "POST",
    "/reports",
    { sourceId, preferences: { freeText: "Focus on loan activity and member engagement" } },
    token,
  );
  log("POST /reports (sourceId, fresh)", !!reportFromSource.finalEvent?.sections, {
    status: reportFromSource.status,
    title: reportFromSource.finalEvent?.title,
    sectionCount: reportFromSource.finalEvent?.sections?.length,
    error: reportFromSource.errorEvent,
  });
  out.reportFromSource = reportFromSource.finalEvent;

  // --- Dashboards ---
  const dash1 = await json("GET", "/dashboards", undefined, token);
  log("GET /dashboards (lazy-create)", dash1.status === 200 && !!dash1.data.id, { id: dash1.data?.id });
  const dashboardId = dash1.data?.id;

  const chartSpecToPin = dataAnswer?.chartSpec ?? convoAnswer?.chartSpec ?? { kind: "bar", data: [] };
  const pinRes = await json(
    "POST",
    `/dashboards/${dashboardId}/pins`,
    { chartSpec: chartSpecToPin, narrative: dataAnswer?.narrative, sourceId, question: "Which members have the most active loans?" },
    token,
  );
  log("POST /dashboards/:id/pins", pinRes.status === 200 && pinRes.data.items.length >= 1, {
    itemCount: pinRes.data?.items?.length,
  });

  const dash2 = await json("GET", "/dashboards", undefined, token);
  log("GET /dashboards after pin", dash2.data?.items?.length >= 1, { itemCount: dash2.data?.items?.length });

  const pinId = dash2.data?.items?.[dash2.data.items.length - 1]?.id;
  const delPin = await json("DELETE", `/dashboards/${dashboardId}/pins/${pinId}`, undefined, token);
  log("DELETE /dashboards/:id/pins/:pinId", delPin.status === 200, { itemCount: delPin.data?.items?.length });

  const dash3 = await json("GET", "/dashboards", undefined, token);
  log("dashboard pin actually removed", !dash3.data.items.some((i) => i.id === pinId), {
    itemCount: dash3.data?.items?.length,
  });

  // --- Demo routes ---
  const demoProfile = await json("GET", "/demo/profile");
  log("GET /demo/profile", demoProfile.status === 200, {
    tables: demoProfile.data?.tables?.map((t) => t.name),
    relationshipCount: demoProfile.data?.relationships?.length,
    confidences: [...new Set((demoProfile.data?.relationships ?? []).map((r) => r.confidence))],
  });
  out.demoProfile = demoProfile.data;

  const demoSuggested = await json("GET", "/demo/suggested-questions");
  log("GET /demo/suggested-questions", demoSuggested.status === 200, { data: demoSuggested.data });

  const demoAsk = await sse("POST", "/demo/ask", { question: "Which products have generated the most revenue across all orders?" });
  log("POST /demo/ask (cross-table)", demoAsk.finalEvent?.answerType === "analysis", {
    answerType: demoAsk.finalEvent?.answerType,
    sql: demoAsk.finalEvent?.sql,
  });
  out.demoAsk = demoAsk.finalEvent;

  // --- Bad inputs ---
  const badEmpty = await sse("POST", `/sources/${sourceId}/ask`, { question: "" }, token);
  log("empty question -> graceful failure", badEmpty.status === 400 || !!badEmpty.errorEvent, {
    status: badEmpty.status,
    body: badEmpty.raw,
  });

  const badSource = await json("POST", "/sources/does-not-exist/ask", { question: "hello" }, token);
  log("nonexistent source id -> 404 not crash", badSource.status === 404, { status: badSource.status, data: badSource.data });

  console.log("\n=== SUMMARY ===");
  const fails = results.filter((r) => !r.ok);
  console.log(`${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) console.log("FAILED:", fails.map((f) => f.name));

  const fs = await import("node:fs");
  fs.writeFileSync(
    new URL("./drive-output.json", import.meta.url),
    JSON.stringify({ results, out }, null, 2),
  );
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
