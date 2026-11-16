<?php
$memcache = new Memcache;
$memcache->connect('memcache.internal', 11211);
$memcached = new Memcached('pool');
$memcached->addServer('mc1.internal', 11211);
$memcached->addServer(getenv('MC2_HOST'), 11211);
$redis = new Redis();
$redis->connect('redis.internal', 6379);
$redis->pconnect('/var/run/redis.sock');
$predis = new Predis\Client('tcp://:secret@redis-cache.internal:6380');
$sessions = new Predis\Client(['host' => 'redis-sessions.internal', 'port' => 6381]);
// Not a cache client: not reported.
$other->connect('elsewhere.internal', 1);
// Classes named as JavaScript object members are not cache clients either.
$builder = new Constructor();
$builder->connect('builder.internal', 1);
$proto = new __proto__();
$proto->connect('proto.internal', 1);
$pool = new PDO('constructor:host=pool.internal');
