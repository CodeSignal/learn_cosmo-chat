/**
 * Amazon Bedrock runtime client construction.
 *
 * Credentials are read from BEDROCK_-prefixed variables rather than the
 * standard AWS_ ones so this app can be pointed at a dedicated Bedrock
 * principal without disturbing any other AWS tooling on the same machine.
 * Passing them explicitly also stops the SDK's default provider chain from
 * silently picking up an unrelated ~/.aws profile.
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

export const DEFAULT_REGION = 'us-east-1';

/**
 * Read explicit Bedrock credentials from the environment.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string } | null}
 */
export function readBedrockCredentials(env = process.env) {
  const accessKeyId = env.BEDROCK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.BEDROCK_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    ...(env.BEDROCK_AWS_SESSION_TOKEN ? { sessionToken: env.BEDROCK_AWS_SESSION_TOKEN } : {}),
  };
}

/** Whether the default AWS provider chain (instance/task role, SSO, ~/.aws) is opted into. */
export function usesDefaultCredentialChain(env = process.env) {
  return env.BEDROCK_AWS_USE_DEFAULT_CREDENTIALS === 'true';
}

/**
 * True when the server has enough configuration to reach Bedrock. Deployments
 * running under an IAM role set BEDROCK_AWS_USE_DEFAULT_CREDENTIALS=true
 * instead of supplying keys.
 */
export function isBedrockConfigured(env = process.env) {
  return Boolean(readBedrockCredentials(env)) || usesDefaultCredentialChain(env);
}

export function bedrockRegion(env = process.env) {
  return env.BEDROCK_AWS_REGION || DEFAULT_REGION;
}

/**
 * Build a BedrockRuntimeClient. Adaptive retry adds client-side rate limiting,
 * which matters because Bedrock throttles on reserved output tokens rather than
 * request count.
 * @param {Record<string, string|undefined>} [env]
 * @returns {BedrockRuntimeClient}
 */
export function createBedrockClient(env = process.env) {
  const credentials = readBedrockCredentials(env);
  return new BedrockRuntimeClient({
    region: bedrockRegion(env),
    ...(credentials ? { credentials } : {}),
    maxAttempts: 5,
    retryMode: 'adaptive',
  });
}
