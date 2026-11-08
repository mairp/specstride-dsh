/**
 * T011 — the acceptance rule (PT-121-004, F121-FR-004; research.md R4).
 *
 * A value is accepted when `schema` is `specstride.view/<n>` with `n` inside
 * the generated major range and the fields the plugin reads have their JSON
 * types. Members of the three closed sets are NOT checked against the enums:
 * a newer engine inside the major renders with `?` (F121-FR-014).
 */
import { SCHEMA_ID, MAJOR_RANGE } from "./generated/contract-values.js";

                        
             
                         
                       
               
                 
                                                                
  
                                                                                                                                    
                          
                
                      
                
                       
                     
                          
                
  
                        
                 
                       
                             
                         
                
                  
                                                                                                                                                  
                    
                                             
                                             
                             
                           
                       
                        
                                                     
                                              
                               
  

                                                                                      

                                   
const isRec = (v         )           => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v         )              => typeof v === "string";
const isStrOrNull = (v         )          => v === null || isStr(v);
const isInt = (v         )              => typeof v === "number" && Number.isInteger(v);
const isNum = (v         )          => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v         )          => v === null || isNum(v);
const isBool = (v         )               => typeof v === "boolean";
const each = (v         , test                        )          => Array.isArray(v) && v.every((item) => isRec(item) && test(item));

const SCHEMA_PATTERN = /^specstride\.view\/(\d+)$/;

function majorOf(schema         )                {
  if (!isStr(schema)) return null;
  const match = SCHEMA_PATTERN.exec(schema);
  return match === null ? null : Number.parseInt(match[1]          , 10);
}

function fieldsHoldTheirTypes(v     )          {
  const conditions = v.conditions;
  return (
    isStrOrNull(v.runId) && isStrOrNull(v.workspaceId) && isStrOrNull(v.feature) &&
    isStr(v.state) && isStr(v.display) &&
    isRec(conditions) && isBool(conditions.dead) && isBool(conditions.launchAbandoned) &&
    (conditions.stale === null || (isRec(conditions.stale) && isStr(conditions.stale.reason))) &&
    each(v.cards, (c) => isStr(c.id) && isStrOrNull(c.feature) && (c.phase === null || isInt(c.phase)) && isStr(c.lane) && isStr(c.ruleId) && isRec(c.flags)) &&
    each(v.lanes, (l) => isStr(l.lane) && Array.isArray(l.cards) && l.cards.every(isStr)) &&
    isRec(v.laneTable) && isStr(v.laneTable.id) && isStr(v.laneTable.version) &&
    each(v.attention, (a) => isStr(a.kind) && isStr(a.key) && isStrOrNull(a.since) && isStr(a.oneLine) && isStrOrNull(a.need) && isStr(a.next)) &&
    isInt(v.attentionOmitted) && v.attentionOmitted >= 0 &&
    each(v.budget, (b) => isStr(b.scope) && isStrOrNull(b.role) && isStr(b.level) && isNumOrNull(b.spent) && isNumOrNull(b.cap) && isNumOrNull(b.fraction) && isStr(b.quota)) &&
    isInt(v.budgetOmitted) && v.budgetOmitted >= 0 &&
    each(v.phases, (p) => isInt(p.number) && isStrOrNull(p.title)) &&
    isRec(v.cursor) && isInt(v.cursor.offset) && isInt(v.cursor.lastSeq) &&
    isRec(v.signature) && isStr(v.signature.token)
  );
}

export function refusalLine(found        )         {
  return `Kanban cannot read this view (schema ${found}, supported ${SCHEMA_ID}) — run /specstride-doctor`;
}

export function acceptView(value         )               {
  if (!isRec(value)) return { ok: false, line: refusalLine("none") };
  const found = isStr(value.schema) ? value.schema : "none";
  const major = majorOf(value.schema);
  if (major === null || major < MAJOR_RANGE.from || major > MAJOR_RANGE.to) return { ok: false, line: refusalLine(found) };
  if (!fieldsHoldTheirTypes(value)) return { ok: false, line: refusalLine(found) };
  return { ok: true, view: value                        };
}
