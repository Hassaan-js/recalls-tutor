export type Entitlement = {startsAt:Date;endsAt:Date;revokedAt:Date|null};
// This primitive does not enforce the question cap or pool restriction of trials.
// Do not use it as the complete practice guard until the trial service is implemented.
export function isEntitlementActive(entitlement: Entitlement, now:Date): boolean {
 return entitlement.revokedAt === null && entitlement.startsAt <= now && entitlement.endsAt > now;
}
