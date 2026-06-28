-- Atelier OmniCore — Section 2: Multi-Tenant Relational Schema
-- Requires PostgreSQL 15+ with pgvector extension

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- TENANTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name                TEXT        NOT NULL,
    subscription_status         TEXT        NOT NULL DEFAULT 'trialing'
                                            CHECK (subscription_status IN (
                                                'trialing', 'active', 'past_due', 'cancelled', 'paused'
                                            )),
    lemon_squeezy_customer_id   TEXT        UNIQUE,
    lemon_squeezy_subscription_id TEXT      UNIQUE,
    stripe_customer_id          TEXT,
    stripe_subscription_id      TEXT,
    grace_period_ends_at        TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_subscription_status
    ON tenants (subscription_status);

-- ---------------------------------------------------------------------------
-- BRANDS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    brand_name              TEXT        NOT NULL,
    widget_config_json      JSONB       NOT NULL DEFAULT '{}',
    allowed_domains_array   TEXT[]      NOT NULL DEFAULT '{}',
    inbound_email_prefix    TEXT        UNIQUE,
    ai_system_prompt        TEXT,
    ai_confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.70,
    help_center_cname       TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brands_tenant_id   ON brands (tenant_id);
CREATE INDEX IF NOT EXISTS idx_brands_email_prefix ON brands (inbound_email_prefix);

-- ---------------------------------------------------------------------------
-- AGENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name                    TEXT        NOT NULL,
    email                   TEXT        NOT NULL,
    password_hash           TEXT        NOT NULL,
    role                    TEXT        NOT NULL DEFAULT 'agent'
                                        CHECK (role IN ('admin', 'agent', 'supervisor')),
    brand_access_array      UUID[]      NOT NULL DEFAULT '{}',
    personal_settings_json  JSONB       NOT NULL DEFAULT '{}',
    avatar_url              TEXT,
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_role      ON agents (tenant_id, role);

-- ---------------------------------------------------------------------------
-- PASSWORD RESET / SET-PASSWORD TOKENS
-- Used by the forgot-password flow and the agent-invite (set-password) flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    UUID        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    token       TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens (token);
CREATE INDEX IF NOT EXISTS idx_prt_agent ON password_reset_tokens (agent_id);

-- ---------------------------------------------------------------------------
-- VISITORS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    brand_id        UUID        NOT NULL REFERENCES brands  (id) ON DELETE CASCADE,
    session_token   TEXT        NOT NULL UNIQUE,
    email           TEXT,
    display_name    TEXT,
    ip_address      INET,
    location_city   TEXT,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitors_tenant_brand ON visitors (tenant_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_visitors_session       ON visitors (session_token);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen     ON visitors (last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- CONVERSATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    brand_id            UUID        NOT NULL REFERENCES brands  (id) ON DELETE CASCADE,
    visitor_id          UUID        NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    assigned_agent_id   UUID        REFERENCES agents(id) ON DELETE SET NULL,
    status              TEXT        NOT NULL DEFAULT 'ai_handling'
                                    CHECK (status IN ('ai_handling', 'open', 'closed', 'pending')),
    priority            TEXT        NOT NULL DEFAULT 'normal'
                                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    csat_score          SMALLINT    CHECK (csat_score BETWEEN 1 AND 5),
    csat_requested      BOOLEAN     NOT NULL DEFAULT false,
    sla_breach_at       TIMESTAMPTZ,
    subject             TEXT,
    channel             TEXT        NOT NULL DEFAULT 'widget'
                                    CHECK (channel IN ('widget', 'email', 'api')),
    referrer_url        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_brand  ON conversations (tenant_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_conversations_visitor       ON conversations (visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent         ON conversations (assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status        ON conversations (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_sla           ON conversations (sla_breach_at)
    WHERE sla_breach_at IS NOT NULL AND status != 'closed';

-- ---------------------------------------------------------------------------
-- MESSAGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id     UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type         TEXT        NOT NULL
                                    CHECK (sender_type IN ('visitor', 'agent', 'bot', 'system')),
    sender_id           UUID,
    message_body        TEXT        NOT NULL,
    is_internal_note    BOOLEAN     NOT NULL DEFAULT FALSE,
    attachments_json    JSONB       NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_internal     ON messages (conversation_id)
    WHERE is_internal_note = TRUE;

-- ---------------------------------------------------------------------------
-- KNOWLEDGE ARTICLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_articles (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    brand_id            UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    title               TEXT        NOT NULL,
    public_html_content TEXT        NOT NULL DEFAULT '',
    plain_text_content  TEXT        NOT NULL DEFAULT '',
    is_public           BOOLEAN     NOT NULL DEFAULT FALSE,
    is_vectorized       BOOLEAN     NOT NULL DEFAULT FALSE,
    author_agent_id     UUID        REFERENCES agents(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_tenant_brand ON knowledge_articles (tenant_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_articles_public       ON knowledge_articles (brand_id, is_public)
    WHERE is_public = TRUE;

-- ---------------------------------------------------------------------------
-- AI EMBEDDINGS  (pgvector — 1536 dims matches text-embedding-ada-002 / Gemini)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_embeddings (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id      UUID        NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    brand_id        UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
    source_url      TEXT,
    chunked_text    TEXT        NOT NULL,
    embedding_vector VECTOR(1536) NOT NULL,
    token_count     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for approximate nearest-neighbour search (cosine similarity)
-- Rebuild with higher lists value once you have > 100k rows.
CREATE INDEX IF NOT EXISTS idx_embeddings_brand_vector
    ON ai_embeddings
    USING ivfflat (embedding_vector vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_embeddings_brand_id ON ai_embeddings (brand_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['tenants','brands','agents','conversations','knowledge_articles']
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;
             CREATE TRIGGER trg_%I_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl, tbl, tbl
        );
    END LOOP;
END;
$$;
