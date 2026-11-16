<?php
// PHP 4/5.2 style: nothing a rule dates.
require_once dirname(__FILE__) . '/lib.php';

class Legacy_Report
{
    var $rows = array();
    var $limit = -1;

    function Legacy_Report($rows)
    {
        $this->rows = $rows;
    }

    function render(array $columns, $title = 'Report')
    {
        list($first, $rest) = $columns;
        $out = <<<EOT
<h1>$title</h1>
EOT;
        foreach ($this->rows as $key => $row) {
            $out .= $row ? implode(',', $row) : '';
        }
        return $out;
    }
}

$report = new Legacy_Report(array(1, 2));
echo $report->render(array('a', 'b'));
?>
<p><?php echo 'done'; ?></p>
