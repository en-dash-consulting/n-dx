#!/bin/bash

##############################################################################
# ndx Gauntlet Test Runner Script
#
# Runs the ndx gauntlet test suite inside a Windows Docker container.
# Provides real-time output streaming, proper exit codes, and cleanup.
#
# Usage:
#   ./run-gauntlet.sh [OPTIONS]
#
# Options:
#   --no-build         Skip building the Docker image (use existing)
#   --keep-container   Don't remove container after tests complete
#   --detach           Run container in background (don't stream output)
#   --verbose          Enable verbose output
#   --help             Show this help message
#
# Environment Variables:
#   DOCKER_BUILDKIT    Set to 1 to use BuildKit (faster builds)
#   CONTAINER_NAME     Override default container name (default: ndx-gauntlet-test)
#   IMAGE_TAG          Override default image tag (default: ndx-gauntlet:latest)
#
# Exit Codes:
#   0 - All tests passed
#   1 - Tests failed
#   2 - Docker command failed
#   3 - Configuration error
##############################################################################

set -o pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER_NAME="${CONTAINER_NAME:-ndx-gauntlet-test}"
IMAGE_TAG="${IMAGE_TAG:-ndx-gauntlet:latest}"
DOCKERFILE="${SCRIPT_DIR}/Dockerfile.windows"
DOCKER_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# Flags
SKIP_BUILD=false
KEEP_CONTAINER=false
DETACH_MODE=false
VERBOSE=false

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

##############################################################################
# Utility Functions
##############################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[DEBUG]${NC} $1"
    fi
}

##############################################################################
# Help and Validation
##############################################################################

show_help() {
    head -n 36 "$0" | tail -n +3
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        log_info "Install Docker from: https://docs.docker.com/get-docker/"
        return 1
    fi
    log_verbose "Docker found: $(docker --version)"
}

check_docker_running() {
    if ! docker ps &> /dev/null; then
        log_error "Docker daemon is not running"
        log_info "Start Docker and try again"
        return 2
    fi
    log_verbose "Docker daemon is running"
}

##############################################################################
# Container Operations
##############################################################################

build_image() {
    log_info "Building Docker image: $IMAGE_TAG"
    log_info "Dockerfile: $DOCKERFILE"
    log_info "Context: $PROJECT_ROOT"

    # Use BuildKit if DOCKER_BUILDKIT is set
    local docker_opts=""
    if [ -n "$DOCKER_BUILDKIT" ]; then
        log_verbose "Using Docker BuildKit"
        docker_opts="--progress=plain"
    fi

    if ! docker build \
        $docker_opts \
        -f "$DOCKERFILE" \
        -t "$IMAGE_TAG" \
        "$PROJECT_ROOT"; then
        log_error "Failed to build Docker image"
        return 2
    fi

    log_success "Docker image built successfully"
}

run_tests() {
    local test_command="pnpm test"

    log_info "Starting container: $CONTAINER_NAME"
    log_info "Running command: $test_command"
    echo ""

    # Prepare docker run options
    local docker_run_opts="-it"
    local docker_rm_opt="--rm"

    if [ "$DETACH_MODE" = true ]; then
        docker_run_opts="-d"
        docker_rm_opt=""  # Don't auto-remove in detach mode
    fi

    if [ "$KEEP_CONTAINER" = true ]; then
        docker_rm_opt=""
    fi

    # Run tests in container
    local exit_code=0
    if ! docker run \
        $docker_run_opts \
        $docker_rm_opt \
        --name "$CONTAINER_NAME" \
        -e NODE_ENV=test \
        "$IMAGE_TAG" \
        powershell -Command "$test_command"; then
        exit_code=$?
        log_error "Tests failed with exit code $exit_code"
    else
        log_success "Tests completed successfully"
    fi

    echo ""
    return $exit_code
}

cleanup() {
    local test_exit_code=$1

    if [ "$DETACH_MODE" = true ]; then
        log_info "Container running in background: $CONTAINER_NAME"
        log_info "View logs with: docker logs -f $CONTAINER_NAME"
        return $test_exit_code
    fi

    if [ "$KEEP_CONTAINER" = true ]; then
        log_warn "Container preserved for inspection: $CONTAINER_NAME"
        log_info "Remove with: docker rm $CONTAINER_NAME"
        log_info "View logs with: docker logs $CONTAINER_NAME"
        return $test_exit_code
    fi

    # Container auto-removed by --rm flag
    log_success "Cleaned up container: $CONTAINER_NAME"
    return $test_exit_code
}

##############################################################################
# Main Execution
##############################################################################

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-build)
                SKIP_BUILD=true
                shift
                ;;
            --keep-container)
                KEEP_CONTAINER=true
                shift
                ;;
            --detach)
                DETACH_MODE=true
                shift
                ;;
            --verbose|-v)
                VERBOSE=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo ""
                show_help
                exit 3
                ;;
        esac
    done

    log_info "ndx Gauntlet Test Runner"
    echo ""

    # Validate prerequisites
    if ! check_docker; then
        exit 3
    fi

    if ! check_docker_running; then
        exit 2
    fi

    # Build image if needed
    if [ "$SKIP_BUILD" = false ]; then
        if ! build_image; then
            exit 2
        fi
        echo ""
    else
        log_info "Skipping image build (--no-build)"
        echo ""
    fi

    # Run tests
    local test_exit_code=0
    if ! run_tests; then
        test_exit_code=$?
    fi

    # Cleanup and return
    cleanup $test_exit_code
    exit $test_exit_code
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
