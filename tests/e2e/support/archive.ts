/**
 * Test adapter for the production receiver verifier.
 *
 * Keeping this file deliberately thin ensures browser acceptance tests exercise
 * the same bounded archive and semantic verification path shipped to operators.
 */
export {
  type VerifiedEvidenceBundle,
} from "../../../verifier/evidence-verifier";
export { verifyEvidenceBundleFile as verifyEvidenceBundle } from "../../../verifier/evidence-verifier-file";
