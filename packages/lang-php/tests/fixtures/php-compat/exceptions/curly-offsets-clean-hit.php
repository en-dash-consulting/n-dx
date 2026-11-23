<?php
// A closure (5.3) in a part of the file the parse reads cleanly still dates
// it; the recovered named argument after the curly-brace offsets does not.
$trim = function ($s) { return trim($s); };

function utf162utf8($utf16)
{
    $char = pack('C*', ord($utf16{$c}), ord($utf16{$c + 1}));
    $bytes = $utf16{$i} . ':' . $char;
    return $utf16{0} === '-' ? substr($bytes, 1) : $bytes;
}

function encode($var)
{
    try { $ret = _encode($var); } catch (Exception $e) { return null; }
    return $ret ? $ret : 'null';
}
