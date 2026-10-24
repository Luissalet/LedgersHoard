import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { init as initDb, close, db } from "../server/db.js";
import { createAccount } from "../server/accounts.js";
import { createEntry } from "../server/entries.js";
import { spendingAnomalies } from "../server/anomalies.js";
import { recurringCandidates } from "../server/recurring.js";
import { tempDir } from "./helpers.js";

test("report links retain native evidence order, exact IDs and each account currency including a spike outside its evidence", async () => {
  const dir=tempDir();initDb(dir);
  let vite;
  try {
    const eur=createAccount({name:"EUR QA",currency:"EUR"}),usd=createAccount({name:"USD QA",currency:"USD"});
    const add=(account,date,amount,counterparty)=>createEntry({account_id:account.id,date,amount_cents:-amount,counterparty,note:`Original ${account.name} ${date}`});
    add(eur,"2026-07-10",1299,"Café QA");add(eur,"2026-07-10",1299,"Café QA");
    add(usd,"2026-07-10",1299,"Café QA");add(usd,"2026-07-10",1299,"Café QA");
    for(const account of [eur,usd])for(const month of ["05","06","07"])add(account,`2026-${month}-15`,2000,"Servicios QA");
    for(const month of ["01","02","03"])add(eur,`2026-${month}-20`,1000,"Recibo variable QA");
    add(eur,"2026-07-20",5000,"Recibo variable QA");
    const before=db().prepare("SELECT * FROM entries ORDER BY id").all();
    const anomalies=spendingAnomalies({to:"2026-07"}),recurring=recurringCandidates({to:"2026-07"});
    const spike=anomalies.anomalies.find(item=>item.kind==="amount_spike");
    assert.ok(spike);assert.ok(spike.evidence.every(entry=>entry.id!==spike.entry_id));
    vite=await createServer({server:{middlewareMode:true,hmr:false},logLevel:"error"});
    const {AnomalyRows,EvidenceLinks}=await vite.ssrLoadModule("/src/components/ReportEvidence.jsx");
    const html=renderToStaticMarkup(React.createElement("table",null,React.createElement("tbody",null,React.createElement(AnomalyRows,{items:anomalies.anomalies,symbol:"€"}))));
    const ids=[...html.matchAll(/href="#\/movimientos\?tx=([^"\s]+)"/g)].map(match=>decodeURIComponent(match[1]));
    assert.deepEqual(ids,anomalies.anomalies.flatMap(item=>[item.entry_id,...item.evidence.map(entry=>entry.id)]));
    const candidates=recurring.candidates.filter(item=>item.counterparty==="Servicios QA");assert.equal(candidates.length,2);
    for(const item of candidates){
      const evidence=renderToStaticMarkup(React.createElement(EvidenceLinks,{item,symbol:"€"}));
      assert.deepEqual([...evidence.matchAll(/href="#\/movimientos\?tx=([^"\s]+)"/g)].map(match=>decodeURIComponent(match[1])),item.evidence.map(entry=>entry.id));
      assert.match(evidence,new RegExp(item.currency==="EUR"?"€":"USD"));
      for(const entry of item.evidence)assert.equal(db().prepare("SELECT account_id FROM entries WHERE id=?").get(entry.id).account_id,item.account==="EUR QA"?eur.id:usd.id);
    }
    assert.deepEqual(db().prepare("SELECT * FROM entries ORDER BY id").all(),before);
  } finally {await vite?.close();close();fs.rmSync(dir,{recursive:true,force:true});}
});
