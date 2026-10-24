import { PRODUCT_EGRESS_POLICY } from './product-egress-policy'

// D33 (revised 2026-10-24): Axiom V1 has no cloud account and this build ships no cloud sign-in defaults.
// Settings › Axiom Account and the links into it check this switch, so the app never offers a sign-in it cannot honour.
export const CLOUD_ACCOUNT_AVAILABLE: boolean = PRODUCT_EGRESS_POLICY.cloudAuth !== null
