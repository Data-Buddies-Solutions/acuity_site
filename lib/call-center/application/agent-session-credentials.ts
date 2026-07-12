export type AgentSessionCredentialActor = {
  allowedLocationIds: string[];
  hasAllLocationAccess: boolean;
  practiceId: string;
  userId: string;
};

export type AgentSessionCredentialInput = {
  activationEnabled: boolean;
  clientInstanceId: string;
  endpointId: string;
  sessionId: string;
};

export type AgentSessionCredential = {
  endpointLabel: string;
  providerCredentialId: string;
};

export interface AgentSessionCredentialStore {
  resolve(
    actor: AgentSessionCredentialActor,
    input: AgentSessionCredentialInput,
    now: Date,
  ): Promise<AgentSessionCredential | null>;
}

export class AgentSessionCredentialError extends Error {
  readonly status = 404;

  constructor() {
    super("Canonical agent session not found");
    this.name = "AgentSessionCredentialError";
  }
}

/** Authorizes provider credentials only through one current canonical lease. */
export async function authorizeAgentSessionCredential(
  store: AgentSessionCredentialStore,
  actor: AgentSessionCredentialActor,
  input: AgentSessionCredentialInput,
  now = new Date(),
) {
  const credential = await store.resolve(actor, input, now);
  if (!credential) throw new AgentSessionCredentialError();
  return credential;
}
