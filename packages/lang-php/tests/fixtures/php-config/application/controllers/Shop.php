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

    // A local `$config` handed to a library: not a settings file.
    public function page()
    {
        $config['base_url'] = '/shop/page';
        $this->pagination->initialize($config);
    }
}
