// Read-only Printavo API v2 integration. Credentials remain in Render environment.
const API = "https://www.printavo.com/api/v2";
const ARTWORK_STATUSES = [
  "JEN TO CREATE ARTWORK",
  "DESIGN IN PROCESS / INTRODUCTION",
  "EMAIL - ART APPROVAL SENT",
  "ART DECLINED",
  "ARTWORK APPROVED - PREP FOR PRODUCTION",
];
const TROY_STATUSES = [
  "QUOTE APPROVED",
  "NON WRAP - FULL PAYMENT REQUEST",
  "50% DEPOSIT REQUEST - WRAPS",
  "DEPOSIT RECEIVED - READY FOR DESIGNER - PRINT WORK ORDER",
  "APPAREL PAID - ADD INVENTORY TO CART",
  "READY FOR PRODUCTION",
  "READY TO SCHEDULE",
  "EMAIL - IN PRODUCTION",
];
const MADYSEN_STATUSES = [
  "READY FOR PRODUCTION",
  "READY TO SCHEDULE",
  "INSTALL SCHEDULED - READY FOR INSTALLER",
  "EMAIL - IN PRODUCTION",
  "EMAIL - ORDER READY FOR PICKUP",
  "ORDER ON HOLD (ISSUE)",
];
const BRYAN_STATUSES = [
  "QUOTE",
  "EMAIL - QUOTE APPROVAL SENT",
  "QUOTE DECLINED",
  "BRYAN TO FOLLOW UP",
];
const normalize = s => String(s ?? "").replace(/[^a-z0-9]+/gi, " ").trim().toUpperCase();

async function graphql(query, variables = {}) {
  const email = process.env.PRINTAVO_EMAIL;
  const token = process.env.PRINTAVO_API_TOKEN;
  if (!email || !token) throw new Error("Printavo credentials are not configured");
  const response = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", email, token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Printavo HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map(e => e.message).join("; "));
  return payload.data;
}

async function getInvoicesForStatuses(requestedStatuses) {
  const wanted = new Set(requestedStatuses.map(normalize));
  const statuses = [];
  let cursor = null;
  do {
    const data = await graphql(`query($after:String) {
      statuses(first:25,after:$after) {
        nodes { id name }
        pageInfo { hasNextPage endCursor }
      }
    }`, { after: cursor });
    const page = data.statuses;
    statuses.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  const matching = statuses.filter(s => wanted.has(normalize(s.name)));
  const missing = requestedStatuses.filter(name => !matching.some(s => normalize(s.name) === normalize(name)));
  if (!matching.length) return { invoices: [], matchingStatuses: [], missingStatuses: missing };
  const invoices = [];
  cursor = null;
  do {
    const data = await graphql(`query($ids:[ID!],$after:String) {
      invoices(statusIds:$ids,first:25,after:$after) {
        nodes {
          id visualId nickname url dueAt productionNote
          contact { fullName }
          status { id name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`, { ids: matching.map(s => s.id), after: cursor });
    const page = data.invoices;
    invoices.push(...page.nodes.map(i => ({
      id: i.id, invoiceNumber: i.visualId, customer: i.contact?.fullName ?? "",
      job: i.nickname ?? "", status: i.status?.name ?? "", dueAt: i.dueAt,
      notes: i.productionNote ?? "", url: i.url,
    })));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (invoices.length > 10000) throw new Error("Invoice safety limit reached");
  } while (cursor);
  return { invoices, matchingStatuses: matching, missingStatuses: missing };
}

export async function getArtworkInvoices() { return getInvoicesForStatuses(ARTWORK_STATUSES); }
export async function getTroyInvoices() { return getInvoicesForStatuses(TROY_STATUSES); }

export async function getBryanInvoices() { return getInvoicesForStatuses(BRYAN_STATUSES); }

export async function getMadysenInvoices() { return getInvoicesForStatuses(MADYSEN_STATUSES); }
