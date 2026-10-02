// Mirrors backend/src/utils/gstState.ts so the live preview shows the same
// CGST/SGST vs IGST split the server and PDF will use.
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export const INDIAN_STATES: string[] = Object.values(GST_STATE_CODES).sort((a, b) => a.localeCompare(b));

const STATE_ALIASES: Record<string, string> = {
  newdelhi: 'delhi',
  nctofdelhi: 'delhi',
  orissa: 'odisha',
  pondicherry: 'puducherry',
  uttaranchal: 'uttarakhand',
  damananddiu: 'dadraandnagarhavelianddamananddiu',
  dadraandnagarhaveli: 'dadraandnagarhavelianddamananddiu',
};

const normalizeState = (state: string): string => {
  const key = state.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
  return STATE_ALIASES[key] || key;
};

const stateFromGstin = (gstin?: string): string | undefined => GST_STATE_CODES[(gstin || '').trim().slice(0, 2)];

export type SupplyType = 'INTRA_STATE' | 'INTER_STATE';

export const getPlaceOfSupply = (customer: { gstin?: string; state?: string }): string | undefined => {
  const state = stateFromGstin(customer.gstin) || customer.state;
  if (!state) return undefined;
  const code = Object.keys(GST_STATE_CODES).find((c) => normalizeState(GST_STATE_CODES[c]) === normalizeState(state));
  return code ? `${GST_STATE_CODES[code]} (${code})` : state;
};

export const getSupplyType = (
  businessGstin: string | undefined,
  customer: { gstin?: string; state?: string }
): SupplyType => {
  const businessState = stateFromGstin(businessGstin);
  const customerState = stateFromGstin(customer.gstin) || customer.state;
  if (!businessState || !customerState) return 'INTRA_STATE';
  return normalizeState(businessState) === normalizeState(customerState) ? 'INTRA_STATE' : 'INTER_STATE';
};
