import { createServer } from "node:http";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || "";
const ORIGIN = process.env.SHOPIFY_ORIGIN || "https://creativecoatingskc.com";
const SEND_EMAIL = process.env.ENABLE_CUSTOMER_EMAIL === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const hits = new Map();
const completed = new Map();
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
  if(!SMTP_USER||!SMTP_PASS) throw new Error("Email configuration missing");
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||465),secure:Number(process.env.SMTP_PORT||465)===465,auth:{user:SMTP_USER,pass:SMTP_PASS}});
  await transport.sendMail({from:process.env.INTAKE_FROM||SMTP_USER,to:email,subject:"We Received Your Wrap Quote Request | Creative Coatings",text:"Hi "+firstName+",\n\nThanks for reaching out to Creative Coatings!\n\nWe've received your commercial vehicle wrap request. Our team will review your project details and reach out if we need any additional information before preparing your quote.\n\nWe appreciate the opportunity to help brand your business!\n\nCreative Coatings\nBrand Your Business.\ncreativecoatingskc.com"});
  return true;
}
async function processLead(d) {
  const email=clean(d.email).toLowerCase();
  const contact=await hubspot("/crm/v3/objects/contacts/"+encodeURIComponent(email)+"?idProperty=email","PATCH",{properties:{firstname:clean(d.firstName),lastname:clean(d.lastName),phone:clean(d.phone),company:clean(d.businessName)}}).catch(async e=>{
    if(!e.message.startsWith("HubSpot 404:")) throw e;
    return hubspot("/crm/v3/objects/contacts","POST",{properties:{email,firstname:clean(d.firstName),lastname:clean(d.lastName),phone:clean(d.phone),company:clean(d.businessName)}});
  });
  const details=["Business: "+clean(d.businessName),"Vehicle: "+clean(d.vehicleType),"Quantity: "+clean(d.vehicleCount),"Year/make/model: "+clean(d.vehicleDetails),"Coverage: "+clean(d.coverage),"Artwork: "+clean(d.artworkStatus),"Timeline: "+clean(d.timeline),"Budget: "+clean(d.budget),"Notes: "+clean(d.notes)].join("\n");
  const deal=await hubspot("/crm/v3/objects/deals","POST",{properties:{dealname:clean(d.businessName)+" - Commercial Wrap Quote",pipeline:"default",dealstage:"4494748354",service_category:"vehicle_wraps",description:details}});
  await hubspot("/crm/v4/objects/deals/"+deal.id+"/associations/default/contacts/"+contact.id,"PUT");
  let emailed=false,emailError=null;
  try { emailed=await sendConfirmation(email,clean(d.firstName)); } catch(e) {emailError="Customer email failed; review server logs";console.error(e);}
  return {dealId:deal.id,contactId:contact.id,emailed,emailError};
}
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://localhost");
  if(url.pathname==="/health") return json(res,200,{ok:true,service:"commercial-wrap-intake",configured:!!TOKEN,emailEnabled:SEND_EMAIL});
  if(url.pathname!=="/api/commercial-wrap") return json(res,404,{error:"Not found"});
  if(req.method==="OPTIONS") {res.writeHead(204,{"access-control-allow-origin":ORIGIN,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","vary":"Origin"});return res.end();}
  if(req.method!=="POST"||req.headers.origin!==ORIGIN) return json(res,403,{error:"Forbidden"});
  const ip=req.headers["x-forwarded-for"]?.split(",")[0]||req.socket.remoteAddress||"unknown";
  const now=Date.now();const recent=(hits.get(ip)||[]).filter(t=>now-t<600000);
  if(recent.length>=5) return json(res,429,{error:"Too many requests"});
  recent.push(now);hits.set(ip,recent);
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>16000)return json(res,413,{error:"Too large"});}
  let d;try{d=JSON.parse(raw);}catch{return json(res,400,{error:"Invalid JSON"});}
  if(d.website) return json(res,200,{ok:true});
  if(fields.some(f=>!clean(d[f])))return json(res,400,{error:"Please complete all required fields"});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(d.email)))return json(res,400,{error:"Invalid email"});
  if(!Number.isInteger(Number(d.vehicleCount))||Number(d.vehicleCount)<1||Number(d.vehicleCount)>1000)return json(res,400,{error:"Invalid vehicle count"});
  if(!TOKEN)return json(res,503,{error:"Integration not configured"});
  const key=clean(d.submissionId);
  if(!/^[a-zA-Z0-9-]{12,80}$/.test(key))return json(res,400,{error:"Missing submission reference"});
  if(completed.has(key))return json(res,200,{ok:true,duplicate:true,reference:completed.get(key)});
  try{const result=await processLead(d);completed.set(key,result.dealId);return json(res,200,{ok:true,reference:result.dealId,emailSent:result.emailed,emailWarning:result.emailError});}
  catch(e){console.error("Lead processing failed",e);return json(res,502,{error:"We could not process the request. Please call the shop."});}
});
server.listen(PORT,"0.0.0.0",()=>console.log("Commercial wrap intake listening on "+PORT));
