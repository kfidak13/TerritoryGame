/**
 * Borderfall runs without OpenFront's closed-source API worker (accounts,
 * store, cosmetics, matchmaking, news, the multi-server registry). Code that
 * only makes sense with that service checks this flag and stays out of the
 * way: no backend polling, no ads, no store or account UI.
 *
 * Off under vitest so OpenFront's own tests keep exercising the API paths.
 */
export const STANDALONE = import.meta.env.MODE !== "test";

/**
 * Whether this Borderfall server runs its own account service (sign-in with
 * Discord or Google, profiles and stats; src/server/accounts). It names the
 * service in the page when it does.
 */
export function hasAccounts(): boolean {
  return (
    typeof window !== "undefined" &&
    window.BOOTSTRAP_CONFIG?.accountApi !== undefined
  );
}
