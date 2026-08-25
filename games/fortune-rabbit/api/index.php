<?php
require_once("../api/inc/functions.inc.php");


header("Access-Control-Allow-Headers: *");
header("Access-Control-Allow-Origin: https://cberfs0z7g.s3.sa-east-1.amazonaws.com");

header('Access-Control-Allow-Methods: GET, POST');


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
