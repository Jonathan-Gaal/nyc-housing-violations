// Building owner/landlord lookups, sourced from HPD's Registration Contacts
// dataset (Socrata feu5-w2e2), joined on registration_id — the field HPD's
// violations dataset (wvxf-dwi5) already carries per row (lib/socrata.ts),
// now persisted onto buildings (db/migrations/004_add_landlord_data.sql).
//
// Note on the dataset landscape: HPD's "Multiple Dwelling Registrations"
// dataset (tesw-yqqr) is also keyed by registration_id but does NOT contain
// owner names — only building/registration metadata. The names live in this
// separate Registration Contacts table.
//
// A registration can list several contacts (CorporateOwner/IndividualOwner,
// Agent, HeadOfficer, Officer, Shareholder, SiteManager...). CorporateOwner
// is usually an LLC name; HeadOfficer is usually a real person's name behind
// it — showing both is what actually gets past the "who's the LLC" opacity
// this data source only partially solves.
import type { Pool } from 'pg';
import { fetchJsonArrayWithRetry } from './socrata';

const DATASET_ID = 'feu5-w2e2';
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

interface RegistrationContact {
  type?: string;
  corporationname?: string;
  firstname?: string;
  lastname?: string;
  businesshousenumber?: string;
  businessstreetname?: string;
  businesscity?: string;
  businessstate?: string;
  businesszip?: string;
}

export interface LandlordInfo {
  registrationId: string;
  ownerName: string | null;
  ownerType: string | null;
  officerName: string | null;
  agentName: string | null;
  businessAddress: string | null;
}

function contactName(c: RegistrationContact): string | null {
  if (c.corporationname) return c.corporationname;
  const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
}

function businessAddress(c: RegistrationContact): string | null {
  const street = [c.businesshousenumber, c.businessstreetname].filter(Boolean).join(' ').trim();
  const cityState = [c.businesscity, c.businessstate].filter(Boolean).join(', ');
  const full = [street, cityState, c.businesszip].filter((part) => part && part.length > 0).join(', ');
  return full.length > 0 ? full : null;
}

async function fetchLandlordInfo(registrationId: string): Promise<LandlordInfo | null> {
  const url = `${BASE_URL}?registrationid=${encodeURIComponent(registrationId)}`;
  const contacts = await fetchJsonArrayWithRetry<RegistrationContact>(url);
  if (contacts.length === 0) return null;

  const owner = contacts.find((c) => c.type === 'CorporateOwner' || c.type === 'IndividualOwner');
  const officer = contacts.find((c) => c.type === 'HeadOfficer');
  const agent = contacts.find((c) => c.type === 'Agent');

  return {
    registrationId,
    ownerName: owner ? contactName(owner) : null,
    ownerType: owner?.type ?? null,
    officerName: officer ? contactName(officer) : null,
    agentName: agent ? contactName(agent) : null,
    businessAddress: businessAddress(owner ?? agent ?? {}),
  };
}

function rowToLandlordInfo(row: {
  registration_id: string;
  owner_name: string | null;
  owner_type: string | null;
  officer_name: string | null;
  agent_name: string | null;
  business_address: string | null;
}): LandlordInfo | null {
  // All-null is the cached marker for "Socrata had no contacts for this
  // registration_id" (see getOrFetchLandlord) — surface it the same way a
  // fresh miss does, as null, not an all-null-fields object.
  if (!row.owner_name && !row.officer_name && !row.agent_name && !row.business_address) {
    return null;
  }
  return {
    registrationId: row.registration_id,
    ownerName: row.owner_name,
    ownerType: row.owner_type,
    officerName: row.officer_name,
    agentName: row.agent_name,
    businessAddress: row.business_address,
  };
}

// Cache-then-fetch, same pattern as lib/socrata.ts's fetchAndLoadZip: reads
// the landlords table first, only hits Socrata on a cache miss, and caches
// what it finds (including a genuine "no contacts on file" miss, so a
// building without owner data doesn't re-fetch on every view).
export async function getOrFetchLandlord(
  pool: Pool,
  registrationId: string
): Promise<LandlordInfo | null> {
  const cached = await pool.query(
    `SELECT registration_id, owner_name, owner_type, officer_name, agent_name, business_address
     FROM landlords WHERE registration_id = $1`,
    [registrationId]
  );
  if (cached.rows.length > 0) {
    return rowToLandlordInfo(cached.rows[0]);
  }

  const info = await fetchLandlordInfo(registrationId);

  // Cache a "no contacts on file" miss too (all-null row keyed by
  // registration_id) — otherwise a building with genuinely no Registration
  // Contacts data re-hits Socrata on every single card expansion.
  const toCache = info ?? {
    registrationId,
    ownerName: null,
    ownerType: null,
    officerName: null,
    agentName: null,
    businessAddress: null,
  };

  await pool.query(
    `INSERT INTO landlords (registration_id, owner_name, owner_type, officer_name, agent_name, business_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (registration_id) DO UPDATE SET
       owner_name = excluded.owner_name,
       owner_type = excluded.owner_type,
       officer_name = excluded.officer_name,
       agent_name = excluded.agent_name,
       business_address = excluded.business_address`,
    [
      toCache.registrationId,
      toCache.ownerName,
      toCache.ownerType,
      toCache.officerName,
      toCache.agentName,
      toCache.businessAddress,
    ]
  );

  return info;
}
