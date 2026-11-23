<?php
namespace App;

use LaunchDarkly\LDClient;
use Unleash\Client\UnleashBuilder;

class Flags
{
    public function render(LDClient $ld, $context, $features)
    {
        if ($ld->variation('new-pricing', $context, false)) {
            return 'pricing';
        }
        $unleash = UnleashBuilder::create()->build();
        $beta = $unleash->isEnabled('beta_dashboard');
        if (\Config::get('features.export')) {
            return 'export';
        }
        return isFeatureEnabled('legacy-import') || $features->isActive('quick_view');
    }
}
