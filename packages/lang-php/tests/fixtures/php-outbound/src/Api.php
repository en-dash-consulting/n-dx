<?php
namespace App;

use GuzzleHttp\Client;

class Api
{
    private $http;

    public function __construct()
    {
        $this->http = new Client(['base_uri' => getenv('API_BASE')]);
    }

    public function users()
    {
        return $this->http->get('/users');
    }

    public function hook($other)
    {
        $guzzle = new \GuzzleHttp\Client();
        $guzzle->request('POST', 'https://hooks.example.com/deploy');
        $guzzle->postAsync('https://hooks.example.com/async');
        // Not a known Guzzle client: not reported.
        return $other->get('/elsewhere');
    }

    public function soap()
    {
        // App\SoapClient, not PHP's: not reported.
        return new SoapClient('https://not-php.example.com/?wsdl');
    }
}
