import { action } from "./_generated/server";

/**
 * Temporary test action to verify environment variables are accessible in Convex
 */
export const checkEnvVars = action(async () => {
  const googleId = process.env.AUTH_GOOGLE_ID;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  
  return {
    hasGoogleId: !!googleId,
    hasGoogleSecret: !!googleSecret,
    googleIdLength: googleId?.length || 0,
    googleSecretLength: googleSecret?.length || 0,
    // Don't log the actual secrets, just confirm they exist
    allEnvVars: Object.keys(process.env).filter(key => 
      key.includes("GOOGLE") || key.includes("AUTH")
    ),
  };
});
