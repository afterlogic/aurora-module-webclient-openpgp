<?php

class OpenPgpWebclientModule extends AApiModule
{
	public function GetAppData()
	{
		return array(
			'EnableModule' => true // AppData.User.EnableOpenPgp
		);
	}
}
