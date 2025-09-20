// config/db-schema.js
// Defines the database schema for all tables using Knex.

async function createTables(knex) {
    // app_config
    await knex.schema.createTableIfNotExists('app_config', table => {
        table.text('key').primary();
        table.text('value');
    });

    // commands
    await knex.schema.createTableIfNotExists('commands', table => {
        table.increments('id').primary();
        table.text('command_tag').unique().notNullable();
        table.text('command_id');
        table.text('block_name');
        table.text('block_role');
        table.text('block_content');
        table.text('command_type');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    // custom_providers
    await knex.schema.createTableIfNotExists('custom_providers', table => {
        table.increments('id').primary();
        table.text('provider_id').unique().notNullable();
        table.text('display_name');
        table.text('api_base_url');
        table.text('api_keys');
        table.text('model_id');
        table.text('model_display_name');
        table.boolean('is_enabled').defaultTo(true);
        table.text('enforced_model_name');
        table.integer('max_context_tokens');
        table.integer('max_output_tokens');
        table.text('provider_type').defaultTo('openai');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    // global_prompt_blocks
    await knex.schema.createTableIfNotExists('global_prompt_blocks', table => {
        table.increments('id').primary();
        table.text('provider').notNullable();
        table.text('name');
        table.text('role');
        table.text('content');
        table.integer('position');
        table.boolean('is_enabled').defaultTo(true);
        table.text('block_type');
        table.text('replacement_command_id');
    });

    // request_logs
    await knex.schema.createTableIfNotExists('request_logs', table => {
        table.increments('id').primary();
        table.text('request_id').unique().notNullable();
        table.text('provider');
        table.text('token_name');
        table.jsonb('request_payload');
        table.integer('status_code');
        table.jsonb('response_payload');
        table.text('character_name');
        table.text('detected_commands');
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // sessions
    await knex.schema.createTableIfNotExists('sessions', table => {
        table.string('sid').primary();
        table.json('sess').notNullable();
        table.timestamp('expired').notNullable();
    });

    // summarizer_prompt_blocks
    await knex.schema.createTableIfNotExists('summarizer_prompt_blocks', table => {
        table.increments('id').primary();
        table.text('provider').notNullable();
        table.text('name');
        table.text('role');
        table.text('content');
        table.integer('position');
        table.boolean('is_enabled').defaultTo(true);
    });

    // user_tokens
    await knex.schema.createTableIfNotExists('user_tokens', table => {
        table.increments('id').primary();
        table.text('name').notNullable();
        table.text('token').unique().notNullable();
        table.integer('rpm').defaultTo(60);
        table.boolean('is_enabled').defaultTo(true);
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('expires_at');
    });
}

module.exports = { createTables };
