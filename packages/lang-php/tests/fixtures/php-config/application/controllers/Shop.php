<?php
class Shop extends CI_Controller
{
    public function index()
    {
        if ($this->config->item('enable_hooks')) {
            $this->hooks();
        }
        $url = $this->config->item('base_url');
    }
}
