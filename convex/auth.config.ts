/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 * Convex platform auth config - tells Convex which OIDC issuers to trust.
 * Required for Convex Auth. Domain is your Convex site URL.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL ?? "https://rapid-trout-661.convex.site",
      applicationID: "convex",
    },
  ],
};
