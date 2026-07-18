/**
 * Test adapter for the production receiver verifier.
 *
 * Keeping this file deliberately thin ensures browser acceptance tests exercise
 * the same bounded archive and semantic verification path shipped to operators.
 */
export {
  verifyEvidenceBundleFile as verifyEvidenceBundle,
  type VerifiedEvidenceBundle,
} from "../../../verifier/evidence-verifier";
