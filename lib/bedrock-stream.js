/**
 * Bridges Bedrock's ConverseStream event union to the small, flat event shape
 * the browser store consumes over SSE.
 *
 * Emitted events:
 *   { type: 'reasoning-delta', text }  extended-reasoning tokens
 *   { type: 'text-delta',      text }  visible answer tokens
 *   { type: 'done', stopReason, usage }
 */

import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

/** Stream exception members ConverseStream can deliver mid-stream. */
const STREAM_EXCEPTIONS = [
  'internalServerException',
  'modelStreamErrorException',
  'validationException',
  'throttlingException',
  'serviceUnavailableException',
];

/**
 * Send one Converse turn and yield normalized streaming events.
 *
 * @param {import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient} client
 * @param {object} request
 * @param {string} request.modelId
 * @param {Array<object>} request.messages
 * @param {string} [request.system] - System prompt text.
 * @param {object} [request.inferenceConfig]
 * @param {object} [request.additionalModelRequestFields]
 * @param {AbortSignal} [request.abortSignal]
 */
export async function* streamAssistantReply(client, {
  modelId,
  messages,
  system,
  inferenceConfig,
  additionalModelRequestFields,
  abortSignal,
}) {
  const command = new ConverseStreamCommand({
    modelId,
    messages,
    ...(system ? { system: [{ text: system }] } : {}),
    ...(inferenceConfig ? { inferenceConfig } : {}),
    ...(additionalModelRequestFields ? { additionalModelRequestFields } : {}),
  });

  const response = await client.send(command, { abortSignal });
  if (!response.stream) return;

  let stopReason;
  let usage;

  for await (const event of response.stream) {
    for (const name of STREAM_EXCEPTIONS) {
      if (event[name]) {
        const error = new Error(event[name].message || name);
        error.name = name;
        throw error;
      }
    }

    const delta = event.contentBlockDelta?.delta;
    if (delta?.reasoningContent?.text) {
      yield { type: 'reasoning-delta', text: delta.reasoningContent.text };
    }
    if (delta?.text) {
      yield { type: 'text-delta', text: delta.text };
    }

    if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason;
    if (event.metadata?.usage) usage = event.metadata.usage;
  }

  yield { type: 'done', stopReason, usage };
}

/**
 * Turn an AWS SDK error into a message safe to show a user. Bedrock's own
 * messages are descriptive and actionable (missing model access, bad region,
 * throttling), so they're worth surfacing rather than hiding behind a generic
 * failure.
 * @param {unknown} err
 */
export function describeBedrockError(err) {
  const name = err?.name ?? 'Error';
  const message = err?.message ?? 'Unknown error';

  switch (name) {
    case 'AccessDeniedException':
      return `Bedrock denied the request. Check that the credentials allow bedrock:InvokeModelWithResponseStream and that model access is enabled in this region. (${message})`;
    case 'ResourceNotFoundException':
      return `Bedrock could not find that model in this region. Verify the model or inference profile ID. (${message})`;
    case 'ThrottlingException':
      return `Bedrock is throttling requests. Try again in a moment. (${message})`;
    case 'ValidationException':
      return `Bedrock rejected the request: ${message}`;
    default:
      return `${name}: ${message}`;
  }
}
