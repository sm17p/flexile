# Development environment setup and testing
set shell := ["bash", "-c"]

# Variables
dev_backend_port := "3000"
dev_frontend_port := "3001"
dev_inngest_port := "8288"
dev_host := "localhost:3000"

test_backend_port := "3100"
test_frontend_port := "3101"
test_inngest_port := "8298"
test_host := "localhost:3100"

# =============================================================================
# MAIN DEVELOPMENT COMMANDS
# =============================================================================

# Start development environment (default)
default *args:
    @just dev {{args}}

# Full development setup and start
dev *args:
    @just setup-env
    @just install-deps
    @just kill-dev-ports
    @just start-dev {{args}}

# Start development services (assumes setup is done)
start-dev *args:
    #!/bin/bash
    echo "Starting development services..."
    set -e
    echo "Generating SSL certificates and starting local services..."
    make local

    export NODE_EXTRA_CA_CERTS="$(node docker/createCertificate.js)"

    # Generate combined SSL certificates
    mkdir -p tmp
    default_cert_file=$(ruby -ropenssl -e 'puts OpenSSL::X509::DEFAULT_CERT_FILE')
    combined_cert_file="tmp/combined_ca_certs.pem"

    if [ -f "$default_cert_file" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
        cat "$default_cert_file" "$NODE_EXTRA_CA_CERTS" > "$combined_cert_file"
        echo "Combined certificates created at $combined_cert_file"
        export SSL_CERT_FILE="$combined_cert_file"
    else
        echo "Warning: Could not create combined cert file. Using default certificates."
    fi
    foreman start -f Procfile.dev {{args}}

# =============================================================================
# TESTING COMMANDS
# =============================================================================

# Run unit tests
test-unit:
    #!/bin/bash
    set -e
    export RAILS_ENV=test
    echo "🧪 Running backend unit tests..."
    cd backend
    bundle exec rspec --format progress --no-profile spec/models/ spec/policies/ spec/services/ spec/sidekiq/ spec/support/

# Run API tests
test-api:
    #!/bin/bash
    set -e
    export RAILS_ENV=test
    echo "🔌 Running backend API tests..."
    cd backend
    bundle exec rspec spec/controllers/ spec/requests/ --format progress --no-profile

# Run system tests (requires test server)
test-system:
    #!/bin/bash
    set -e
    export RAILS_ENV=test
    echo "🖥️  Running Rails system tests..."
    if ! just --quiet check-test-server; then
        echo "❌ Test server not running. Please run 'just test-server' in another terminal first."
        exit 1
    fi
    cd backend
    bundle exec rspec --tag ~skip --tag ~type:system --format progress

# Run E2E tests (requires test server)
test-e2e:
    #!/bin/bash
    set -e
    export RAILS_ENV=test
    export NODE_ENV=test
    echo "🎭 Running Playwright E2E tests..."
    if ! just --quiet check-test-server; then
        echo "❌ Test server not running. Please run 'just test-server' in another terminal first."
        exit 1
    fi
    pnpm playwright test e2e/tests/settings/administrator/roles.spec.ts --ui --workers=2

# Run all tests with automatic test server management
test-all:
    #!/bin/bash
    set -e
    echo "🚀 Running all tests..."

    # First run backend tests that don't need the test server
    just test-unit
    just test-api

    echo ""
    echo "🔄 Starting test server for system and E2E tests..."

    # Start test server in background
    just test-server > test_server.log 2>&1 &
    TEST_SERVER_PID=$!

    # Wait for test server to be ready
    echo "⏳ Waiting for test server to start..."
    for i in {1..60}; do
        if just --quiet check-test-server; then
            echo "✅ Test server is ready"
            break
        fi
        if [ $i -eq 60 ]; then
            echo "❌ Test server failed to start within 60 seconds"
            kill $TEST_SERVER_PID 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done

    # Run system and E2E tests
    just test-system
    just test-e2e

    # Clean up test server
    echo "🧹 Stopping test server..."
    kill $TEST_SERVER_PID 2>/dev/null || true
    wait $TEST_SERVER_PID 2>/dev/null || true
    rm -f test_server.log

    echo "✅ All tests completed"

# Build for test server
test-server-build:
    #!/bin/bash
    NODE_ENV=test pnpm run build-next --debug-prerender

# Start test server
test-server:
    #!/bin/bash
    set -e
    echo "Starting test server..."

    export NODE_TLS_REJECT_UNAUTHORIZED=0
    export RAILS_ENV=test
    export NODE_ENV=test
    export ENABLE_DEFAULT_OTP=true

    just kill-test-ports
    just setup-test-db

    foreman start -f Procfile.test -e .env.test

# Check if test server is running
check-test-server:
    #!/bin/bash
    if lsof -i :{{test_frontend_port}} > /dev/null 2>&1; then
        exit 0
    else
        exit 1
    fi

# =============================================================================
# SETUP & INSTALLATION
# =============================================================================

# Setup development environment
setup-env:
    #!/bin/bash
    set -e
    if [ -f ".vercel/project.json" ]; then
        echo "Pulling environment from Vercel..."
        pnpx vercel env pull .env
    elif [ ! -f ".env" ]; then
        echo ".env file not found. Please run bin/setup first."
        exit 1
    fi

# Setup test environment
setup-test-env:
    #!/bin/bash
    set -e
    echo "🔧 Setting up test environment..."

    # Install dependencies
    pnpm install
    cd backend && bundle install && cd ..

    # Setup environment files
    if [ ! -f .env ]; then
        cp .env.example .env
    fi

    if [ ! -L frontend/.env ]; then
        ln -sf $PWD/.env ./frontend/.env
    fi

    just setup-test-db
    echo "✅ Test environment setup complete"

# clean dev database
clean-dev-db:
    #!/bin/bash
    set -e
    echo "Setting up dev database..."
    cd backend
    bundle exec rails db:drop db:create db:schema:load db:seed_test_data
# clean test database
clean-test-db:
    #!/bin/bash
    set -e
    echo "Setting up test database..."
    cd backend
    RAILS_ENV=test bundle exec rails db:drop db:create db:schema:load db:seed_test_data
# seed dev db
seed-dev-db:
    #!/bin/bash
    set -e
    echo "Seeding up dev database..."
    cd backend
    bundle exec rails db:setup
# seed test db
seed-test-db:
    #!/bin/bash
    set -e
    echo "Seeding up test database..."
    cd backend
    RAILS_ENV=test bundle exec rails db:setup
# setup test db
setup-test-db:
    #!/bin/bash
    cd backend
    RAILS_ENV=test bundle exec rails db:drop db:create db:schema:load db:seed_test_data

# Install all dependencies
install-deps:
    echo "Installing dependencies..."
    pnpm install
    cd backend && bundle install
    cd backend && bin/rails db:prepare

# =============================================================================
# PORT MANAGEMENT
# =============================================================================

# Kill development ports
kill-dev-ports:
    #!/bin/bash
    echo "Cleaning up development ports..."
    just kill-port {{dev_backend_port}}
    just kill-port {{dev_frontend_port}}
    just kill-port {{dev_inngest_port}}
    rm -f backend/tmp/pids/server.pid

# Kill test ports
kill-test-ports:
    #!/bin/bash
    echo "Cleaning up test ports..."
    just kill-port {{test_backend_port}}
    just kill-port {{test_frontend_port}}
    just kill-port 3037
    just kill-port {{test_inngest_port}}

# Kill process on specific port
kill-port port:
    #!/bin/bash
    if lsof -i :{{port}} 2>/dev/null | grep LISTEN > /dev/null; then
        echo "Killing process on port {{port}}"
        lsof -i :{{port}} | grep LISTEN | awk '{print $2}' | xargs -r kill -9
    fi

# =============================================================================
# INDIVIDUAL SERVICES (for development)
# =============================================================================

# Start Rails server
rails:
    cd backend && ./bin/rails s -p {{dev_backend_port}}

# Start Sidekiq
sidekiq:
    cd backend && bundle exec sidekiq -q default -q mailers

# Start TypeScript watch
typecheck:
    pnpm run typecheck:watch

# Start Next.js frontend
next:
    TZ=UTC pnpm next dev frontend -H {{dev_host}} -p {{dev_frontend_port}}

# Start Inngest
inngest:
    pnpm inngest-cli dev --no-discovery -u http://localhost:{{dev_frontend_port}}/api/inngest

# Move seeder commit
rebase *args:
    jj rebase -r yo -d {{args}}


# =============================================================================
# UTILITY COMMANDS
# =============================================================================

# Clean up everything
clean:
    echo "Cleaning up..."
    just kill-dev-ports
    just kill-test-ports
    rm -rf tmp/combined_ca_certs.pem
    rm -f backend/tmp/pids/server.pid
    rm -f test_server.log

# Setup only (without starting services)
setup:
    just setup-env
    just install-deps

# Reseed-data
reseed-dev:
    just setup
    just clean-dev-db
    just seed-dev-db

# Quick restart development (assumes setup is done)
restart *args:
    just kill-dev-ports
    just start-dev {{args}}

# Show status of all services
status:
    #!/bin/bash
    echo "Development services:"
    for port in {{dev_backend_port}} {{dev_frontend_port}} {{dev_inngest_port}}; do
        if lsof -i :$port 2>/dev/null | grep LISTEN > /dev/null; then
            echo "  Port $port: ACTIVE"
        else
            echo "  Port $port: INACTIVE"
        fi
    done

    echo ""
    echo "Test services:"
    for port in {{test_backend_port}} {{test_frontend_port}} {{test_inngest_port}}; do
        if lsof -i :$port 2>/dev/null | grep LISTEN > /dev/null; then
            echo "  Port $port: ACTIVE"
        else
            echo "  Port $port: INACTIVE"
        fi
    done

# List all available commands
list:
    @just --list

# cookie/login problem
erase:
    #!/bin/bash
    jj edit yo
    just clean
    mkcert -uninstall
    rm -rf tmp docker/tmp certificates ~/Library/Application\ Support/mkcert/
    docker-compose -p flexile down --remove-orphans
    sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
