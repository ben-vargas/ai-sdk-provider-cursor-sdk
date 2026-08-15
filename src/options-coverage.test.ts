import type {
  AgentOptions,
  CloudAgentOptions,
  CloudSendOptions,
  InteractionUpdate,
  LocalAgentOptions,
  LocalSendOptions,
  NestedTaskUpdate,
  SendOptions,
} from '@cursor/sdk';

type AgentMappedKey =
  | 'model'
  | 'apiKey'
  | 'name'
  | 'local'
  | 'cloud'
  | 'mcpServers'
  | 'agents'
  | 'mode'
  | 'tools'
  | 'disallowedTools';
type AgentProviderManagedKey = 'agentId' | 'idempotencyKey';
type AgentKnownExcludedKey = never;
type AgentAccountedKey = AgentMappedKey | AgentProviderManagedKey | AgentKnownExcludedKey;

type SendMappedKey = 'model' | 'mode' | 'onDelta' | 'idempotencyKey' | 'local';
type SendProviderManagedKey = never;
type SendKnownExcludedKey = 'onStep' | 'mcpServers' | 'cloud';
type SendAccountedKey = SendMappedKey | SendProviderManagedKey | SendKnownExcludedKey;

type LocalSendMappedKey = 'force';
type LocalSendKnownExcludedKey = 'customTools';
type CloudSendKnownExcludedKey = 'envVars';

type LocalAgentMappedKey =
  | 'cwd'
  | 'dirs'
  | 'autoReview'
  | 'store'
  | 'settingSources'
  | 'sandboxOptions'
  | 'customTools'
  | 'enableAgentRetries';
type CloudAgentMappedKey =
  | 'env'
  | 'repos'
  | 'workOnCurrentBranch'
  | 'autoCreatePR'
  | 'openAsCursorGithubApp'
  | 'skipReviewerRequest'
  | 'envVars'
  | 'metadata';

type InteractionMappedType =
  | 'text-delta'
  | 'thinking-delta'
  | 'thinking-completed'
  | 'tool-call-started'
  | 'partial-tool-call'
  | 'tool-call-completed'
  | 'shell-output-delta'
  | 'turn-ended'
  | 'token-delta'
  | 'step-started'
  | 'step-completed'
  | 'summary'
  | 'summary-started'
  | 'summary-completed'
  | 'user-message-appended'
  | 'tool-call-delta';

// `tool-call-delta.taskUpdate` carries its own narrower union, so it drifts independently of
// `InteractionUpdate['type']`. Every entry below is recursed through the same normalizer switch.
type NestedTaskMappedType =
  | 'text-delta'
  | 'thinking-delta'
  | 'thinking-completed'
  | 'tool-call-started'
  | 'partial-tool-call'
  | 'tool-call-completed'
  | 'step-started'
  | 'step-completed';

type UnaccountedAgentKey = Exclude<keyof AgentOptions, AgentAccountedKey>;
type StaleAgentKey = Exclude<AgentAccountedKey, keyof AgentOptions>;
type UnaccountedSendKey = Exclude<keyof SendOptions, SendAccountedKey>;
type StaleSendKey = Exclude<SendAccountedKey, keyof SendOptions>;
type UnaccountedLocalSendKey = Exclude<
  keyof LocalSendOptions,
  LocalSendMappedKey | LocalSendKnownExcludedKey
>;
type StaleLocalSendKey = Exclude<
  LocalSendMappedKey | LocalSendKnownExcludedKey,
  keyof LocalSendOptions
>;
type UnaccountedCloudSendKey = Exclude<keyof CloudSendOptions, CloudSendKnownExcludedKey>;
type StaleCloudSendKey = Exclude<CloudSendKnownExcludedKey, keyof CloudSendOptions>;
type UnaccountedLocalAgentKey = Exclude<keyof LocalAgentOptions, LocalAgentMappedKey>;
type StaleLocalAgentKey = Exclude<LocalAgentMappedKey, keyof LocalAgentOptions>;
type UnaccountedCloudAgentKey = Exclude<keyof CloudAgentOptions, CloudAgentMappedKey>;
type StaleCloudAgentKey = Exclude<CloudAgentMappedKey, keyof CloudAgentOptions>;
type UnaccountedInteractionType = Exclude<InteractionUpdate['type'], InteractionMappedType>;
type StaleInteractionType = Exclude<InteractionMappedType, InteractionUpdate['type']>;
type UnaccountedNestedTaskType = Exclude<NestedTaskUpdate['type'], NestedTaskMappedType>;
type StaleNestedTaskType = Exclude<NestedTaskMappedType, NestedTaskUpdate['type']>;

// Force assignability in both directions. A newly added or removed SDK key names itself here.
const noUnaccountedAgentKeys: Record<UnaccountedAgentKey, never> = {};
const noStaleAgentKeys: Record<StaleAgentKey, never> = {};
const noUnaccountedSendKeys: Record<UnaccountedSendKey, never> = {};
const noStaleSendKeys: Record<StaleSendKey, never> = {};
const noUnaccountedLocalSendKeys: Record<UnaccountedLocalSendKey, never> = {};
const noStaleLocalSendKeys: Record<StaleLocalSendKey, never> = {};
const noUnaccountedCloudSendKeys: Record<UnaccountedCloudSendKey, never> = {};
const noStaleCloudSendKeys: Record<StaleCloudSendKey, never> = {};
const noUnaccountedLocalAgentKeys: Record<UnaccountedLocalAgentKey, never> = {};
const noStaleLocalAgentKeys: Record<StaleLocalAgentKey, never> = {};
const noUnaccountedCloudAgentKeys: Record<UnaccountedCloudAgentKey, never> = {};
const noStaleCloudAgentKeys: Record<StaleCloudAgentKey, never> = {};
const noUnaccountedInteractionTypes: Record<UnaccountedInteractionType, never> = {};
const noStaleInteractionTypes: Record<StaleInteractionType, never> = {};
const noUnaccountedNestedTaskTypes: Record<UnaccountedNestedTaskType, never> = {};
const noStaleNestedTaskTypes: Record<StaleNestedTaskType, never> = {};

describe('Cursor SDK options and events drift guard', () => {
  it('accounts for every SDK key and interaction event type in both directions', () => {
    expect(
      [
        noUnaccountedAgentKeys,
        noStaleAgentKeys,
        noUnaccountedSendKeys,
        noStaleSendKeys,
        noUnaccountedLocalSendKeys,
        noStaleLocalSendKeys,
        noUnaccountedCloudSendKeys,
        noStaleCloudSendKeys,
        noUnaccountedLocalAgentKeys,
        noStaleLocalAgentKeys,
        noUnaccountedCloudAgentKeys,
        noStaleCloudAgentKeys,
        noUnaccountedInteractionTypes,
        noStaleInteractionTypes,
        noUnaccountedNestedTaskTypes,
        noStaleNestedTaskTypes,
      ].flatMap(Object.keys)
    ).toEqual([]);
  });
});
