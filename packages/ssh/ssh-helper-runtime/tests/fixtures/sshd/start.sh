#!/bin/sh
set -eu
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
install -d -m 700 -o jan -g jan /home/jan/.ssh
install -m 600 -o jan -g jan /fixture-key.pub /home/jan/.ssh/authorized_keys
install -d -m 700 -o jan -g jan /home/jan/workspace
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
