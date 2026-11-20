---
id: "2e742c9b-d521-43ee-992a-6adb3423eed7"
type: "task"
title: "PHP HTTP, SOAP and environment outbound calls"
slug: "php-http-soap-and-environment-outbound"
summary: "Report the web services and environment settings PHP code depends on, so outbound.json shows which legacy repositories call which services."
description: "In `@n-dx/lang-php`, produce `outboundCalls` facts (existing kinds only) that sourcevision writes to outbound.json, following how the Python and Go outbound producers grade `confidence` and `targetSource`:\n\n- http: `curl_init($url)` and `curl_setopt($ch, CURLOPT_URL, $url)`; `file_get_contents`, `fopen`, `file`, `get_headers` with an `http://`/`https://` literal or a computable constant; `new SoapClient($wsdl)`; Guzzle (`new GuzzleHttp\\Client(['base_uri' => …])`, `->get/post/request(...)` on a known client); `fsockopen`. Client names: `curl`, `file_get_contents`, `SoapClient`, `guzzle`, etc.\n- env: `getenv('X')`, `$_ENV['X']`, `$_SERVER['X']` where X is not a request key (exclude the HTTP_*, REQUEST_*, QUERY_STRING, REMOTE_*, SERVER_NAME/PORT/ADDR, SCRIPT_*, PHP_SELF, DOCUMENT_ROOT, HTTPS family). Target is the variable name, targetSource `env`.\n- Targets from config arrays (`$config['api_url']`) get targetSource `config` with the key as written; anything else `unknown`.\n- `mail()` is not an outbound kind; skip it.\n\nFixtures for each client and for request-key exclusion."
acceptanceCriteria:
  - "curl, file/stream HTTP calls, SoapClient, Guzzle and fsockopen appear in outbound.json for PHP repositories with the pack"
  - "getenv, $_ENV and non-request $_SERVER reads appear as env calls, request keys do not"
  - "Non-PHP output is byte-identical"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-php"
  - "outbound"
---
