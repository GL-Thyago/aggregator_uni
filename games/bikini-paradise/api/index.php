<?php
require_once("inc/functions.inc.php");

$info = $_SERVER['PATH_INFO'];
 
$token = explode("/", $info)[1];
$endPoint = explode("/", $info)[2];
$token = E($token);
$validEndpoints = ['session', 'icons', 'spin'];

if (in_array($endPoint, $validEndpoints)) {
    require 'endpoints/' . $endPoint . '.php';
} else {
    die("ERR");
}
