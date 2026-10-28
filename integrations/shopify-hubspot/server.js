import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
const TEST_FORM = readFileSync(new URL("./shopify-form.html", import.meta.url), "utf8").replace("REPLACE_WITH_RENDER_PREVIEW_URL/api/commercial-wrap", "/api/commercial-wrap");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || "";
const ORIGIN = process.env.SHOPIFY_ORIGIN || "https://creativecoatingskc.com";
const SEND_EMAIL = process.env.ENABLE_CUSTOMER_EMAIL === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const GOOGLE_CLIENT_ID=process.env.GOOGLE_CLIENT_ID||"";
const GOOGLE_CLIENT_SECRET=process.env.GOOGLE_CLIENT_SECRET||"";
const GOOGLE_REFRESH_TOKEN=process.env.GOOGLE_REFRESH_TOKEN||"";
const CALLBACK="https://creative-coatings-hubspot-wrap-test.onrender.com/oauth/google/callback";
const oauthStates=new Map();
const hits = new Map();
const completed = new Map();
const pending = new Map();
const fields = ["businessName","firstName","lastName","email","phone","vehicleType","vehicleCount","coverage","artworkStatus","timeline"];
const clean = v => String(v ?? "").trim().slice(0,2000);
function json(res,status,value) { res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":ORIGIN,"vary":"Origin"});res.end(JSON.stringify(value)); }
async function hubspot(path,method,body) {
  const r=await fetch("https://api.hubapi.com"+path,{method,headers:{"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error("HubSpot "+r.status+": "+JSON.stringify(data).slice(0,300));
  return data;
}
async function sendConfirmation(email,firstName) {
  if(!SEND_EMAIL) return false;
  if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_REFRESH_TOKEN) throw new Error("Gmail OAuth configuration missing");
  const transport=nodemailer.createTransport({service:"gmail",auth:{type:"OAuth2",user:"info@creativecoatingskc.com",clientId:GOOGLE_CLIENT_ID,clientSecret:GOOGLE_CLIENT_SECRET,refreshToken:GOOGLE_REFRESH_TOKEN}});
  await transport.sendMail({from:"info@creativecoatingskc.com",to:email,subject:"We Received Your Wrap Quote Request | Creative Coatings",text:"Hi "+firstName+",\n\nThanks for reaching out to Creative Coatings!\n\nWe've received your commercial vehicle wrap request. Our team will review your project details and reach out if we need any additional information before preparing your quote.\n\nWe appreciate the opportunity to help brand your business!\n\nCreative Coatings\nBrand Your Business.\ncreativecoatingskc.com"});
  return true;
}
async function processLead(d) {
  const email=clean(d.email).toLowerCase();
  let contact;
  try { contact=await hubspot("/crm/v3/objects/contacts/"+encodeURIComponent(email)+"?idProperty=email","GET"); }
  catch(e) { if(!e.message.startsWith("HubSpot 404:")) throw e;
    contact=await hubspot("/crm/v3/objects/contacts","POST",{properties:{email,firstname:clean(d.firstName),lastname:clean(d.lastName),phone:clean(d.phone),company:clean(d.businessName)}});
  }
  const details=["Business: "+clean(d.businessName),"Vehicle: "+clean(d.vehicleType),"Quantity: "+clean(d.vehicleCount),"Year/make/model: "+clean(d.vehicleDetails),"Coverage: "+clean(d.coverage),"Artwork: "+clean(d.artworkStatus),"Timeline: "+clean(d.timeline),"Budget: "+clean(d.budget),"Notes: "+clean(d.notes)].join("\n");
  const dealName=(process.env.TEST_ONLY_EMAIL ? "TEST - " : "")+clean(d.businessName)+" - Commercial Wrap Quote [ref:"+clean(d.submissionId)+"]";
  const matches=await hubspot("/crm/v3/objects/deals/search","POST",{filterGroups:[{filters:[{propertyName:"dealname",operator:"EQ",value:dealName}]}],limit:2,properties:["dealname"]});
  let deal=matches.results?.[0];
  const isNew=!deal;
  if(!deal) deal=await hubspot("/crm/v3/objects/deals","POST",{properties:{dealname:dealName,pipeline:"default",dealstage:"4494748354",service_category:"vehicle_wraps",description:details}});
  await hubspot("/crm/v4/objects/deals/"+deal.id+"/associations/default/contacts/"+contact.id,"PUT");
  let emailed=false,emailError=null;
  try { if(isNew) emailed=await sendConfirmation(email,clean(d.firstName)); } catch(e) {emailError="Customer email failed; review server logs";console.error(e);}
  return {dealId:deal.id,contactId:contact.id,emailed,emailError};
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://localhost");
  if(url.pathname==="/oauth/google/start" && req.method==="GET") {
    if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET) return json(res,503,{error:"Google OAuth credentials are not configured"});
    const state=randomBytes(32).toString("hex");oauthStates.set(state,Date.now()+600000);
    for(const [k,exp] of oauthStates) if(exp<Date.now()) oauthStates.delete(k);
    const auth=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for(const [k,v] of Object.entries({client_id:GOOGLE_CLIENT_ID,redirect_uri:CALLBACK,response_type:"code",scope:"https://www.googleapis.com/auth/gmail.send",access_type:"offline",prompt:"consent",state})) auth.searchParams.set(k,v);
    res.writeHead(302,{location:auth.toString(),"cache-control":"no-store"});return res.end();
  }
  if(url.pathname==="/oauth/google/callback" && req.method==="GET") {
    const state=url.searchParams.get("state")||"";const exp=oauthStates.get(state);oauthStates.delete(state);
    if(!exp||exp<Date.now()||url.searchParams.has("error"))return json(res,400,{error:"Authorization was denied or expired. Restart the connection."});
    const code=url.searchParams.get("code");if(!code)return json(res,400,{error:"Missing authorization code"});
    try{
      const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:CALLBACK,grant_type:"authorization_code"})});
      const tokens=await tokenResponse.json();if(!tokenResponse.ok||!tokens.refresh_token)throw Error("No refresh token returned");
      // The credential is shown only to the account owner, never logged or stored in source control.
      const token=tokens.refresh_token;
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex, nofollow","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"});
      return res.end("<!doctype html><meta charset='utf-8'><title>Gmail authorization</title><main style='font:16px Arial;max-width:700px;margin:4rem auto'><h2>Gmail authorization successful</h2><p>Copy the credential below directly into the Render environment variable <strong>GOOGLE_REFRESH_TOKEN</strong>. Never share it in chat or screenshots. Close this tab after saving.</p><textarea readonly style='width:100%;height:100px'>"+token.replace(/[&<>"]/g,"")+"</textarea></main>");
    }catch(e){console.error("Google OAuth exchange failed",e.message);return json(res,502,{error:"Gmail authorization could not be completed. Please restart."});}
  }
  if(url.pathname==="/test-form" && req.method==="GET") {res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex, nofollow","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});return res.end("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Creative Coatings Test Form</title><body style=\"background:#f2ede3\"><h3 style=\"text-align:center\">TEST ONLY — Not a live customer form</h3>"+TEST_FORM+"</body></html>");}
  if(url.pathname==="/health") return json(res,200,{ok:true,service:"commercial-wrap-intake",configured:!!TOKEN,emailEnabled:SEND_EMAIL});
  if(url.pathname!=="/api/commercial-wrap") return json(res,404,{error:"Not found"});
  if(req.method==="OPTIONS") {res.writeHead(204,{"access-control-allow-origin":ORIGIN,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","vary":"Origin"});return res.end();}
  if(req.method!=="POST"||(req.headers.origin!==ORIGIN && req.headers.origin!=="https://creative-coatings-hubspot-wrap-test.onrender.com")) return json(res,403,{error:"Forbidden"});
  const ip=req.headers["x-forwarded-for"]?.split(",")[0]||req.socket.remoteAddress||"unknown";
  const now=Date.now();const recent=(hits.get(ip)||[]).filter(t=>now-t<600000);
  if(recent.length>=5) return json(res,429,{error:"Too many requests"});
  recent.push(now);hits.set(ip,recent);
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>16000)return json(res,413,{error:"Too large"});}
  let d;try{d=JSON.parse(raw);}catch{return json(res,400,{error:"Invalid JSON"});}
  if(d.website) return json(res,200,{ok:true});
  if(process.env.TEST_ONLY_EMAIL && clean(d.email).toLowerCase()!==process.env.TEST_ONLY_EMAIL.toLowerCase()) return json(res,403,{error:"Test service only accepts the authorized test email"});
  if(fields.some(f=>!clean(d[f])))return json(res,400,{error:"Please complete all required fields"});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(d.email)))return json(res,400,{error:"Invalid email"});
  if(!Number.isInteger(Number(d.vehicleCount))||Number(d.vehicleCount)<1||Number(d.vehicleCount)>1000)return json(res,400,{error:"Invalid vehicle count"});
  if(!TOKEN)return json(res,503,{error:"Integration not configured"});
  const key=clean(d.submissionId);
  if(!/^[a-zA-Z0-9-]{12,80}$/.test(key))return json(res,400,{error:"Missing submission reference"});
  if(completed.has(key))return json(res,200,{ok:true,duplicate:true,reference:completed.get(key)});
  if(pending.has(key)) { try { const result=await pending.get(key);return json(res,200,{ok:true,duplicate:true,reference:result.dealId}); } catch {return json(res,502,{error:"The request could not be completed. Contact the shop before retrying."});} }
  const job=processLead(d);pending.set(key,job);
  try{const result=await job;completed.set(key,result.dealId);return json(res,200,{ok:true,reference:result.dealId,emailSent:result.emailed,emailWarning:result.emailError});}
  catch(e){console.error("Lead processing failed",e);return json(res,502,{error:"We could not confirm your request. Please call the shop before resubmitting."});}
  finally{pending.delete(key);}
});
server.listen(PORT,"0.0.0.0",()=>console.log("Commercial wrap intake listening on "+PORT));
