.PHONY: tree
tree:
	@find . -maxdepth 3 -type d -print | sed 's|^\./||' | sort

.PHONY: check
check:
	@ansible --version >/dev/null 2>&1 || (echo "Ansible not installed" && exit 1)
	@echo "OK"
