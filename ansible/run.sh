#!/usr/bin/env bash

set -e

ENV=${1:-dev}

echo "Running Aegis Ansible — Environment: $ENV"

ansible-playbook \
  -i inventories/$ENV/hosts.ini \
  playbook-wireguard.yml \
  --ask-pass \
  --ask-become-pass
