<?php
$billing = new SoapClient('https://billing.example.com/service?wsdl');
$crm = new SoapClient(null, array('location' => 'https://crm.example.com/soap', 'uri' => 'urn:crm'));
$shipping = new \SoapClient($settings['shipping_wsdl'], array('trace' => 1));
$client = new SoapClient(getenv('LEDGER_WSDL'));
