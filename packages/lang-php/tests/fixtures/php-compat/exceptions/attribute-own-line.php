<?php
// Drupal 7: an attribute alone on its line is a # comment before PHP 8.0.
class DatabaseStatementPrefetch implements Iterator
{
    var $data = array();

    #[\ReturnTypeWillChange]
    public function current()
    {
        return current($this->data);
    }

    #[ReturnTypeWillChange] // PHP 8.1 tentative return types
    public function key()
    {
        return key($this->data);
    }
}
