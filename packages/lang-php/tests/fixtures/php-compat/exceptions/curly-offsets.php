<?php
// PHP 5, the shape of WordPress's class-json.php: curly-brace string
// offsets ($var{$c}) break the parse, and the recovered tree reads
// `catch (Exception $e)` as a call with a named argument. Nothing here dates
// the file.
class Services_JSON
{
    function utf162utf8($utf16)
    {
        $char = pack('C*', ord($utf16{$c}), ord($utf16{$c + 1}));
        $bytes = $utf16{$i} . ':' . $char;
        return $utf16{0} === '-' ? substr($bytes, 1) : $bytes;
    }

    function encode($var)
    {
        try { $ret = $this->_encode($var); } catch (Exception $e) { return null; }
        return $ret ? $ret : 'null';
    }
}
