<?php
require_once("inc/functions.inc.php");

$data = json_decode(file_get_contents("php://input"), true);

//$info = $_SERVER['PATH_INFO'];
// $token = explode("/", $info)[1];
$endPoint = $data['action'];
$token = E($data['id']);
$validEndpoints = ['session', 'icons', 'spin'];

if (in_array($endPoint, $validEndpoints)) {
    require 'endpoints/' . $endPoint . '.php';
} else {
    die("ERR");
}
