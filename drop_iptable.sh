sudo iptables -w -D INPUT \
  -p tcp --dport 8001 \
  -m comment --comment "wf-public-8001" \
  -j ACCEPT

sudo netfilter-persistent save
